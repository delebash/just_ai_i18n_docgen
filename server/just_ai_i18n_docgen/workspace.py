# SPDX-License-Identifier: MIT
"""The review Workspace — ported from just-ai-help's `server/server.js`.

WHAT WRITES WHAT — the rule the whole design rests on:

    locale JSON       only ever written by an explicit human action in here
    accepted.json     accept / unaccept
    notes.json        the per-key note that feeds the next translation
    .just-ai-i18n-docgen-state.json   this project: progress, undo, proposals, confirmations, runs
    the shared DB     providers, presets, reviewer — machine state, never per-project

A job never writes a locale file. Engine output is staged and applied by a person.

WHAT CHANGED from the Node version: engine connections and settings.json are GONE —
providers and presets live in the shared LLM stack (/v1/llm-providers, the AI-features
surface), jobs resolve through the SAME engine seam the CLI uses (engine.make_send), and
the reviewer's name lives in the app's own table. The two-resolver bug cannot recur
because there is exactly one resolver to call.

The HTTP routes over this class live in `api/workspace_api.py` (+ setup_api /
server_auth_api / health_api) — the family tree (target-tree P4). This module keeps
the domain: the Workspace holder, the write rules, and the prompt-preview builders.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import HTTPException

from .confirm import build_confirm_prompt
from .jobs import JobManager
from .jsonio import flatten, placeholder_re, rebuild
from .service import Project, all_findings
from .shieldlib import build_system_prompt, build_user_message, shield
from .state import (
    drop_confirmation,
    drop_proposal,
    drop_references,
    proposal_keys,
    review_statuses,
)

_UNLIMITED = 10**9  # a UI scrolls; a CLI report has to truncate


class Workspace:
    """One (optional) loaded project + the job manager + caches. A factory-style
    holder so tests can point it at a temp directory."""

    def __init__(self, config_path: str | Path | None = None):
        self.project: Project | None = None
        self.jobs = JobManager()
        self.term_cache: dict = {}
        if config_path:
            self.load(config_path)

    def load(self, config_path: str | Path) -> None:
        self.project = Project(config_path)
        self.jobs = JobManager(store=self.project.state)
        self.term_cache = {}

    # ── file mutations ───────────────────────────────────────────────────────────

    def write_key(self, lang: str, key: str, value: str | None) -> None:
        """Writes one key back, rebuilding nesting from the SOURCE so the diff is one
        line. `value is None` REMOVES the key — that case exists for undo: a key that
        had no translation must go back to having none; writing "" instead turns a
        `missing` finding into a `blank` one and ships an empty string.

        Also retires everything that was ABOUT the old text: the probe entry (a human
        edit will almost always differ from the machine's second pass, and without this
        the reviewer's own fix becomes the evidence against it), the cached second
        opinion, the staged proposal (a proposal staged against the old string could be
        applied OVER the newer text, silently reverting the reviewer's fix — a real
        bug), and the confirmation verdict."""
        p = self.project
        values = p.target_flat(lang) or {}
        if value is None:
            values.pop(key, None)
        else:
            values[key] = value
        p.paths.target_file(lang).write_text(
            json.dumps(rebuild(p.source_raw, values), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8")
        probe = p.paths.probe_file(lang)
        if probe.exists():
            pf = flatten(json.loads(probe.read_text(encoding="utf-8")))
            if key in pf:
                del pf[key]
                probe.write_text(
                    json.dumps(rebuild(p.source_raw, pf), indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8")
        drop_references(p.state, lang=lang, key=key)
        drop_proposal(p.state, lang=lang, key=key)
        drop_confirmation(p.state, lang=lang, key=key)

    def write_note(self, lang: str, key: str, note: str | None) -> None:
        p = self.project
        notes = flatten(p.read_notes(lang))
        if note is None:
            notes.pop(key, None)
        else:
            notes[key] = note
        p.paths.notes_file(lang).write_text(
            json.dumps(dict(sorted(notes.items())), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8")

    # ── the queue ────────────────────────────────────────────────────────────────

    def findings_for(self, lang: str):
        p = self.project
        target_flat = p.target_flat(lang) or {}
        findings, accepted = all_findings(
            p, lang, target_flat,
            top_n=_UNLIMITED, include_terms=True, term_cache=self.term_cache)
        return target_flat, findings, accepted

    def build_rows(self, lang: str | None = None) -> dict:
        p = self.project
        wanted = [lang] if lang else p.targets
        rows: list[dict] = []
        counts: dict[str, int] = {}
        accepted_total = 0

        for lg in wanted:
            target_flat, findings, accepted = self.findings_for(lg)
            accepted_total += len(accepted)
            statuses = review_statuses(p.state, lg)
            notes = flatten(p.read_notes(lg))
            staged = proposal_keys(p.state, lg)  # one query, not one per row

            by_key: dict[str, list] = {}
            for f in findings:
                by_key.setdefault(f["key"], []).append({
                    "code": f["code"], "detail": f["detail"],
                    "advisory": bool(f.get("advisory")),
                    "suggestion": f.get("suggestion"),
                    "confirmed": f.get("confirmed"),
                    "confirmedBy": f.get("confirmedBy"),
                })
                counts[f["code"]] = counts.get(f["code"], 0) + 1

            for key, flags in by_key.items():
                rows.append({
                    "lang": lg, "key": key,
                    "source": p.src.get(key, ""), "target": target_flat.get(key, ""),
                    "flags": flags,
                    "status": (statuses.get(key) or {}).get("status"),
                    "note": notes.get(key), "hasProposal": key in staged,
                })
            # Keys with no translation at all are work too — the old page hid them.
            for key, src in p.src.items():
                if key not in target_flat and key not in by_key:
                    rows.append({
                        "lang": lg, "key": key, "source": src, "target": "",
                        "flags": [{"code": "missing", "detail": "not translated",
                                   "advisory": False}],
                        "status": (statuses.get(key) or {}).get("status"),
                        "note": notes.get(key), "hasProposal": False,
                    })
                    counts["missing"] = counts.get("missing", 0) + 1

        rows.sort(key=lambda r: (-len(r["flags"]), r["key"], r["lang"]))
        return {"rows": rows, "counts": counts, "accepted": accepted_total,
                "langs": p.targets, "total": len(rows)}


def _pick_preview_lang(p: Project, feature: str) -> str:
    """The default sample language is the BUSIEST one (the agreed A922 default):
    most pending keys for translate; for confirm most byte-identical, then most
    translated. Ties keep target order (Python max returns the first maximum)."""
    if not p.targets:
        return ""

    def counts(lg: str) -> tuple[int, int, int]:
        dst = p.target_flat(lg) or {}
        pending = sum(1 for k in p.src if k not in dst)
        identical = sum(1 for k in p.src if dst.get(k) == p.src[k])
        translated = sum(1 for k in p.src if isinstance(dst.get(k), str) and dst.get(k))
        return pending, identical, translated

    if feature == "confirm":
        return max(p.targets, key=lambda lg: (counts(lg)[1], counts(lg)[2]))
    return max(p.targets, key=lambda lg: counts(lg)[0])


def _preview_translate(p: Project, lang: str, keys: list[str] | None, n: int = 6) -> dict:
    """The REAL translate prompt over a small live sample — the same builders the batch
    loop uses (`loop.translate_language`), shielding included, so the kit's promptless
    Lab shows exactly what a production run sends. A FINISHED language still shows the
    Lab (ruling 2026-08-04: "def show the full lab" — the prompt SHAPE is identical),
    sampling already-translated keys and saying so; the loud 400s are for explicit keys
    that don't exist and a catalogue with no keys at all."""
    # The SAME cfg the real run builds (start_job): the per-language conventions
    # line and the reviewer notes ride the preview too, or the Lab shows a prompt
    # production never sends (audit 2026-08-05 — both were dropped here). The
    # glossary goes through _glossary_list: both shapes are legal everywhere.
    cfg = {**p.cfg,
           "conventionsLine": (p.conventions.get(lang) or {}).get("promptLine", ""),
           "notes": flatten(p.read_notes(lang))}
    ph_re = placeholder_re(cfg["placeholder"])
    terms = _glossary_list(cfg)
    system = build_system_prompt(
        source=cfg.get("sourceLanguage", "en"),
        target_lang=lang,
        do_not_translate=terms,
        conventions_line=cfg["conventionsLine"],
        plural_separator=cfg.get("pluralSeparator"),
    )
    existing = p.target_flat(lang) or {}
    sampled_done = False
    if keys:
        pick = [k for k in keys if k in p.src][:n]
        if not pick:
            raise HTTPException(400, "None of the requested keys exist in the source catalogue.")
    else:
        pick = [k for k in p.src if k not in existing][:n]
        if not pick:
            pick = [k for k in p.src if k in existing][:n]
            sampled_done = True
        if not pick:
            raise HTTPException(400, "The source catalogue has no keys to sample.")
    shielded = []
    for i, k in enumerate(pick):
        sh, _tokens = shield(p.src[k], ph_re, terms)
        shielded.append({"key": k, "text": p.src[k], "i": i, "shielded": sh})
    user = build_user_message(shielded, cfg)
    label = (f"every key translated — sampling {len(shielded)} done key(s)"
             if sampled_done else f"{len(shielded)} pending key(s)")
    return {"system": system, "user": user, "sample": f"{label} · {lang}"}


def _preview_confirm(p: Project, lang: str, keys: list[str] | None) -> dict:
    """The REAL confirm probe prompt: one key, exactly the shape `confirm.make_ask`
    sends (one key per call — never batched, by design). Prefers a byte-identical key
    (confirm's real prey); a healthy project without one still shows the Lab (ruling
    2026-08-04: "def show the full lab") — the prompt SHAPE is identical over any key,
    and the sample line names which fallback fed it. Explicit keys stay loud."""
    dst = p.target_flat(lang) or {}
    if keys:
        same = [k for k in keys if k in p.src and dst.get(k) == p.src[k]]
        if not same:
            raise HTTPException(
                400, f"None of the requested keys are byte-identical in {lang}.")
        picked, note = same[0], "identical key"
    else:
        same = [k for k in p.src if dst.get(k) == p.src[k]]
        if same:
            picked, note = same[0], "identical key"
        else:
            translated = [k for k in p.src
                          if isinstance(dst.get(k), str) and dst.get(k)]
            if translated:
                picked, note = translated[0], "no byte-identical targets right now — sampling"
            elif p.src:
                picked, note = next(iter(p.src)), "nothing translated yet — sampling"
            else:
                raise HTTPException(400, "The source catalogue has no keys to sample.")
    cfg = p.cfg
    terms = (cfg.get("glossary") or {}).get("doNotTranslate") or []
    system = build_confirm_prompt(target_lang=lang, context=cfg.get("context", ""),
                                  do_not_translate=terms)
    src = p.src[picked]
    user = f"Translate items: {json.dumps([{'id': 0, 'text': src}])}"
    return {"system": system, "user": user, "sample": f"{note} {picked} · {lang}"}


def _glossary_list(cfg: dict) -> list:
    """The glossary as a bare list whichever shape the config holds (the original's
    deliberate both-shapes design, infer.py:84 normalizes to the dict on load)."""
    g = cfg.get("glossary")
    if isinstance(g, dict):
        return list(g.get("doNotTranslate") or [])
    return list(g or [])
