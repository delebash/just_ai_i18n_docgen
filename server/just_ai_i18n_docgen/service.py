# SPDX-License-Identifier: MIT
"""The translate service — the flow that composes every ported layer.

Ported from just-ai-help's `server/translate.js`, restructured from a CLI script into
service functions BOTH doors call — the CLI (cli.py) and the review workspace API. The
Node repo's hard rule survives: one implementation of every decision, so a report and an
escalation can never drift into flagging different things, and a config means the same
thing whichever door you came through.

The layers, unchanged: TRANSLATE (loop.py — shield, send, restore, retry, never
silently skip) · VERIFY (checks.py + suspects.py — the differentiator: no translator
makes assertions about its own output) · the confirmation pass (confirm.py — annotates,
never signs off) · acceptances (accepted.py — the human record, hash-expiring).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from importlib import resources
from pathlib import Path

from .accepted import (
    UNKNOWN_REVIEWER,
    acceptance_entry,
    acceptance_hash,
    load_accepted,
    partition_accepted,
    save_accepted,
)
from .checks import build_context, run_checks, summarise
from .confirm import CONFIRM_CODE, attach_confirmations, confirm_identical, make_ask
from .engine import make_send, require_probe_temperature
from .infer import infer_config
from .jsonio import flatten, rebuild
from .loop import translate_language
from .paths import ProjectPaths, project_paths
from .state import JsonStore, confirmations, open_project, put_confirmation
from .suspects import rank_suspects, spread

PROBE_CACHE_FILE = ".jah-probe-cache.json"


def _read_json(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _conventions() -> dict:
    return json.loads(
        resources.files("just_ai_i18n_docgen").joinpath("config/conventions.json")
        .read_text(encoding="utf-8")
    )


class Project:
    """One loaded project: config (inference applied and REPORTED), paths (anchored to
    the config file), the source catalogue, conventions, and the workshop state."""

    def __init__(self, config_path: str | Path):
        self.config_path = Path(config_path)
        if not self.config_path.exists():
            raise FileNotFoundError(f"No config at {config_path}")
        raw_cfg = _read_json(self.config_path)
        self.paths: ProjectPaths = project_paths(self.config_path, raw_cfg)
        self.source_raw = _read_json(self.paths.source_file)
        self.src = flatten(self.source_raw)
        self.cfg, self.inferred = infer_config(raw_cfg, self.src)
        # paths.source_language, not cfg: a `source`-shaped config carries the language
        # in the FILENAME — reading cfg printed "Translating undefined -> es" once.
        self.cfg.setdefault("sourceLanguage", self.paths.source_language)
        self.conventions = _conventions()
        self.state: JsonStore = open_project(self.paths.config_dir)

    @property
    def targets(self) -> list[str]:
        return self.cfg.get("targets", [])

    def read_notes(self, lang: str) -> dict:
        """Per-key notes written during review. Committed — a note changes translation
        output, so it belongs with the run that produced it. Absent file = no notes."""
        path = self.paths.notes_file(lang)
        if not path.exists():
            return {}
        try:
            raw = _read_json(path)
        except (ValueError, OSError):
            return {}
        return {k: v for k, v in flatten(raw).items() if not k.startswith("_")}

    def target_flat(self, lang: str) -> dict | None:
        path = self.paths.target_file(lang)
        if not path.exists():
            return None
        return flatten(_read_json(path))


def all_findings(project: Project, lang: str, target_flat: dict) -> tuple[list, list]:
    """EVERY finding for one language: the structural checks, the disagreement suspects
    when a probe sidecar exists, the confirmation annotations, and the acceptance
    filter LAST — so an acceptance can clear a suspect as well as a check, and
    escalation never re-spends engine time on a key a human already signed off.

    ONE function for the report, the escalate path and the workspace — they can never
    drift into flagging different things."""
    findings = run_checks(
        source_flat=project.src, target_flat=target_flat,
        ctx=build_context(project.cfg, project.conventions, lang),
    )
    probe_path = project.paths.probe_file(lang)
    if probe_path.exists():
        findings = findings + rank_suspects(
            source_flat=project.src, target_flat=target_flat,
            probe_flat=flatten(_read_json(probe_path)),
            top_n=(project.cfg.get("suspects") or {}).get("topN", 20),
        )
    findings = attach_confirmations(
        findings, confirmations(project.state, lang), project.src, target_flat,
    )
    return partition_accepted(
        findings, load_accepted(project.paths.accepted_file(lang)),
        project.src, target_flat,
    )


def translate_into(project: Project, lang: str, subset: dict, send: Callable,
                   *, force: bool = False, out_path: Path | None = None,
                   cache_path: Path | None = None, log: Callable = print) -> dict:
    """Translates `subset` for one language and merges the result over what is already
    there. `out_path`/`cache_path` are parameters because the probe pass runs this SAME
    function into a sidecar with its OWN cache — sharing the main cache would poison
    every later delta (the probe would overwrite the real translation's entries)."""
    out_path = out_path or project.paths.target_file(lang)
    cache_path = cache_path or project.paths.cache_path
    existing = flatten(_read_json(out_path)) if out_path.exists() else {}

    def write(values: dict) -> dict:
        merged = {**existing, **values}
        out_path.write_text(
            json.dumps(rebuild(project.source_raw, merged), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return merged

    result = translate_language(
        source_flat=subset,
        existing_flat={} if force else existing,
        lang=lang,
        cfg={
            **project.cfg,
            "conventionsLine": (project.conventions.get(lang) or {}).get("promptLine", ""),
            "notes": project.read_notes(lang),
        },
        cache_path=cache_path,
        send=send,
        force=force,
        log=log,
        # Written after every batch so an interrupted hour-long run resumes instead of
        # starting over — the file is always complete-and-valid JSON, just with fewer keys.
        on_batch=write,
    )
    merged = write(result["values"])
    log(f"{lang}: wrote {len(result['values'])} keys in {result['requests']} request(s)")
    if result["failed"]:
        log(f"{lang}: {len(result['failed'])} key(s) exhausted every retry: "
            + ", ".join(result["failed"][:8]) + (" …" if len(result["failed"]) > 8 else ""))
    return {**result, "merged": merged}


def run_translate(project: Project, *, send: Callable | None = None,
                  ask: Callable | None = None, force: bool = False, probe: bool = False,
                  no_confirm: bool = False, log: Callable = print) -> dict:
    """The main flow: translate every target, optionally probe, then the confirmation
    pass. Returns {"hard_failures": int, "langs": {...}}."""
    send = send or make_send("translate")
    if probe:
        # Refuse rather than mislead, BEFORE any engine time is spent: at temperature 0
        # the two probe passes are identical by construction. Guarded on the RESOLVED
        # preset — the one source the request body is built from (engine.py).
        require_probe_temperature("translate")

    hard_failures = 0
    langs: dict = {}
    for lang in project.targets:
        result = translate_into(project, lang, project.src, send, force=force, log=log)
        hard_failures += len(result["failed"])
        langs[lang] = {"failed": result["failed"], "requests": result["requests"]}

        if probe:
            # The SAME engine, a second time. force=True because the point is a fresh
            # sample — served from cache it would return the first answer and every key
            # would agree with itself. Its own cache file, never the main one.
            log(f"{lang}: probe pass — same engine, second opinion")
            probed = translate_into(
                project, lang, project.src, send, force=True,
                out_path=project.paths.probe_file(lang),
                cache_path=project.paths.config_dir / PROBE_CACHE_FILE, log=log,
            )
            target = project.target_flat(lang) or {}
            moved = sum(
                1 for k in project.src
                if isinstance(target.get(k), str) and isinstance(probed["merged"].get(k), str)
                and spread(target[k], probed["merged"][k]) > 0
            )
            langs[lang]["probe_moved"] = moved
            log(f"{lang}: probe — {moved}/{len(project.src)} key(s) differed between the two passes")
            if moved == 0:
                # A probe that finds nothing looks exactly like a catalogue with nothing
                # wrong, and those are very different states — the second is worth
                # celebrating, the first means the instrument is broken. This tool exists
                # because a run that silently did nothing looked like a run that worked.
                log(f"{lang}: WARNING — the two passes agreed on EVERY key. That is "
                    "implausible for a real catalogue; suspect the sampler, the cache or "
                    "the engine rather than reading this as a clean bill of health.")

    if not no_confirm:
        _confirmation_pass(project, ask=ask, log=log)
    return {"hard_failures": hard_failures, "langs": langs}


def _confirmation_pass(project: Project, *, ask: Callable | None = None,
                       log: Callable = print) -> None:
    """Runs only after a real translate, only over the LIVE identical findings — a key a
    human signed off is never re-asked. BOTH outcomes are annotations in the state file;
    NEITHER is a verdict: the engine never writes <lang>.accepted.json."""
    ask = ask or make_ask("confirm")
    for lang in project.targets:
        dst = project.target_flat(lang)
        if dst is None:
            continue
        findings, _ = all_findings(project, lang, dst)
        keys = [f["key"] for f in findings if f["code"] == CONFIRM_CODE]
        if not keys:
            continue
        log(f"{lang}: confirming {len(keys)} identical key(s)")
        result = confirm_identical(
            keys=keys, source_flat=project.src, target_flat=dst,
            target_lang=lang, context=project.cfg.get("context", ""),
            do_not_translate=(project.cfg.get("glossary") or {}).get("doNotTranslate", []),
            ask=ask,
        )
        by = "engine (confirm preset)"
        for c in result["cleared"]:
            put_confirmation(project.state, lang=lang, key=c["key"],
                             hash=acceptance_hash(key=c["key"], code=CONFIRM_CODE,
                                                  src=c["src"], dst=c["dst"] or ""),
                             verdict="same", engine=by)
        for p in result["proposed"]:
            put_confirmation(project.state, lang=lang, key=p["key"],
                             hash=acceptance_hash(key=p["key"], code=CONFIRM_CODE,
                                                  src=p["src"], dst=p["dst"] or ""),
                             verdict="translate", suggestion=p["suggestion"], engine=by)
        log(f"  {len(result['cleared'])} look correct as-is — approve them in the review "
            "page (nothing was signed off for you)")
        if result["proposed"]:
            log(f"  {len(result['proposed'])} look SKIPPED. Suggestions, NOT applied:")
            for p in result["proposed"]:
                log(f"      {p['key']}  {json.dumps(p['src'])} -> {json.dumps(p['suggestion'])}")
        if result["failed"]:
            log(f"  {len(result['failed'])} could not be checked (engine error) — left as findings")


def run_check(project: Project, *, log: Callable = print) -> dict:
    """The post-checks — verify the FILES on disk, not the run that wrote them. Offline
    and deterministic: what you run before you ship. `disagreement` is ADVISORY and does
    not fail the result — a suspect says the model was unsure, not that it was wrong,
    and failing on suspicion is exactly how a report gets ignored."""
    failed = 0
    langs: dict = {}
    for lang in project.targets:
        dst = project.target_flat(lang)
        if dst is None:
            log(f"FAIL {lang}: no output file")
            failed += 1
            langs[lang] = {"missing_file": True}
            continue
        findings, accepted_now = all_findings(project, lang, dst)
        translated = sum(1 for k in project.src if dst.get(k))
        log(f"\n{lang}: {translated}/{len(project.src)} translated")
        for code, items in summarise(findings).items():
            if code != "disagreement":
                failed += len(items)
            note = " [advisory — review or escalate]" if code == "disagreement" else ""
            log(f"  {code} ({len(items)}){note}: " + ", ".join(f["key"] for f in items))
            for f in items:
                if f.get("suggestion"):
                    log(f"      {f['key']}: suggested {json.dumps(f['suggestion'])} (not applied)")
        if not findings:
            log("  all checks passed")
        # ALWAYS printed, even at zero: an accepted finding is hidden from the exit
        # code, never from the reader.
        if accepted_now:
            log(f"  {len(accepted_now)} accepted as correct (in {lang}.accepted.json), not counted")
        langs[lang] = {"findings": findings, "accepted": len(accepted_now),
                       "translated": translated}
    return {"failed": failed, "langs": langs}


def run_escalate(project: Project, preset_id: str, *, log: Callable = print) -> dict:
    """Check what is on disk, re-translate ONLY what was flagged — checks AND suspects,
    "everything flagged plus the top N" — with a different preset, then re-check and
    report before/after. The cheap engine's work stays; the expensive one is spent only
    on the keys that earned it."""
    send = make_send(preset_id=preset_id)
    out: dict = {}
    for lang in project.targets:
        target = project.target_flat(lang)
        if target is None:
            log(f"{lang}: nothing to escalate — no {lang}.json yet. Translate first.")
            out[lang] = {"missing_file": True}
            continue
        before, before_ok = all_findings(project, lang, target)
        keys = sorted({f["key"] for f in before})
        log(f"{lang}: {len(before)} finding(s) across {len(keys)} key(s) before"
            + (f" ({len(before_ok)} accepted, not escalated)" if before_ok else ""))
        if not keys:
            out[lang] = {"before": 0, "after": 0}
            continue

        subset = {k: project.src[k] for k in keys if k in project.src}
        result = translate_into(project, lang, subset, send, force=True, log=log)

        # Retire the probe entries for the keys just escalated: a disagreement means
        # "THIS engine was unsure here"; once a DIFFERENT engine has redone the key, the
        # old second opinion measures nothing — keeping it would flag the key forever.
        probe_path = project.paths.probe_file(lang)
        if probe_path.exists():
            probe_flat = flatten(_read_json(probe_path))
            for k in keys:
                probe_flat.pop(k, None)
            probe_path.write_text(
                json.dumps(rebuild(project.source_raw, probe_flat), indent=2,
                           ensure_ascii=False) + "\n", encoding="utf-8")

        after, _ = all_findings(project, lang, result["merged"])
        log(f"{lang}: {len(before)} -> {len(after)} finding(s), "
            f"{len(keys)} -> {len({f['key'] for f in after})} key(s)")
        out[lang] = {"before": len(before), "after": len(after),
                     "failed": result["failed"]}
    return out


def accept_keys(project: Project, keys: list[str], *, by: str = "",
                log: Callable = print) -> dict:
    """Records the CURRENT findings for these keys as reviewed-and-correct. No engine
    call — a check-time verdict. The checks run WITHOUT the acceptance filter, because
    accepting is about what they currently say and filtering first would make a second
    accept on the same key a silent no-op."""
    reviewer = by or UNKNOWN_REVIEWER
    recorded = 0
    for lang in project.targets:
        dst = project.target_flat(lang)
        if dst is None:
            log(f"{lang}: nothing to accept — no {lang}.json yet.")
            continue
        path = project.paths.accepted_file(lang)
        store = load_accepted(path)
        raw = run_checks(source_flat=project.src, target_flat=dst,
                         ctx=build_context(project.cfg, project.conventions, lang))
        for key in keys:
            for_key = [f for f in raw if f["key"] == key]
            if not for_key:
                log(f"{lang}: {key} — no current findings, nothing to accept")
                continue
            for f in for_key:
                entry = acceptance_entry(key=key, code=f["code"],
                                         src=project.src.get(key, ""),
                                         dst=dst.get(key, ""), by=reviewer)
                store[acceptance_hash(key=key, code=f["code"],
                                      src=entry["src"], dst=entry["dst"])] = entry
                log(f"{lang}: accepted {f['code']} on {key}")
                recorded += 1
        save_accepted(path, store)
    log(f"\n{recorded} finding(s) recorded as reviewed by \"{reviewer}\".")
    if reviewer == UNKNOWN_REVIEWER:
        # Loud rather than silent: an acceptance claims a human looked, and when nobody
        # said who, the file says so and the person running it knows it will.
        log("\nWARNING: recorded as \"unknown\" — nobody claimed these verdicts. "
            "Pass --by <name> so the sidecar records who signed them off.")
    return {"recorded": recorded, "reviewer": reviewer}
