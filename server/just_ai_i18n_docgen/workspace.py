# SPDX-License-Identifier: MIT
"""The review workspace API — ported from just-ai-help's `server/server.js`.

WHAT WRITES WHAT — the rule the whole design rests on:

    locale JSON       only ever written by an explicit human action in here
    accepted.json     accept / unaccept
    notes.json        the per-key note that feeds the next translation
    .jah-state.json   this project: progress, undo, proposals, confirmations, runs
    the shared DB     providers, presets, reviewer — machine state, never per-project

A job never writes a locale file. Engine output is staged and applied by a person.

WHAT CHANGED from the Node version: engine connections and settings.json are GONE —
providers and presets live in the shared LLM stack (/v1/llm-providers, the AI-features
surface), jobs resolve through the SAME engine seam the CLI uses (engine.make_send), and
the reviewer's name lives in the app's own table. The two-resolver bug cannot recur
because there is exactly one resolver to call.

The server starts WITHOUT a project — the setup screen has to be reachable before a
config exists. Routes needing one get a 409 with `needsSetup` from one dependency, not
a change to every handler. Loading REPLACES the project wholesale; there is no
swap-while-running path, because a half-swapped project with a job in flight is a bug
waiting to be written.
"""

from __future__ import annotations

import json
import queue
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse

from . import appmeta
from .accepted import acceptance_entry, acceptance_hash, load_accepted, save_accepted
from .checks import build_context, check_one, run_checks
from .engine import EngineNotConfigured, make_send
from .init import gitignore_lines, plan_init, write_init
from .jobs import JobBusyError, JobManager
from .jsonio import flatten, rebuild
from .service import Project, all_findings
from .shieldlib import parse_items
from .state import (
    action_history,
    drop_all_proposals,
    drop_confirmation,
    drop_proposal,
    drop_references,
    get_reference,
    pop_action,
    proposal_count,
    proposal_keys,
    proposals,
    put_reference,
    record_action,
    review_progress,
    review_statuses,
    set_review_status,
)
from .terms import check_key_terms, check_terms, term_usage

# The only scopes a run may have. Anything else is a typo, and a typo must not start a
# job — found by driving the real catalogue: an unrecognised scope fell through to the
# flagged branch and started a 154-key run. `pending` is the dashboard's button: keys
# with no translation at all PLUS flagged ones — `flagged` alone selects nothing on a
# fresh language, because a key that is missing has no finding to flag.
SCOPES = {"flagged", "unsure", "all", "keys", "pending"}

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


def make_workspace_router(ws: Workspace) -> APIRouter:
    # /v1 like every family route — JW and JV put their OWN app routes under /v1
    # beside the shared stack's; /api was a Node-era habit, corrected 2026-08-02.
    router = APIRouter(tags=["workspace"], prefix="/v1")

    def project() -> Project:
        if ws.project is None:
            raise HTTPException(status_code=409,
                                detail={"error": "no project loaded yet", "needsSetup": True})
        return ws.project

    # ── setup: works with NO project — it is the screen that CREATES one ─────────

    @router.get("/setup/state")
    def setup_state() -> dict:
        from importlib import resources

        languages = json.loads(
            resources.files("just_ai_i18n_docgen").joinpath("config/languages.json")
            .read_text(encoding="utf-8"))
        p = ws.project
        return {
            "loaded": p is not None,
            "configPath": str(p.config_path) if p else None,
            "source": str(p.paths.source_file) if p else None,
            "langs": p.targets if p else [],
            # Prefill, not decoration: an edit screen that shows blanks over a
            # configured project invites "save" to feel like it erased something.
            "context": (p.cfg.get("context") or "") if p else "",
            "glossary": (p.cfg.get("glossary") or []) if p else [],
            "reviewer": appmeta.get_reviewer(),
            # Codes only. The display name is derived in the browser from
            # Intl.DisplayNames, so the menu reads in the user's own language and no
            # English name can go stale here.
            "languages": languages,
        }

    @router.post("/setup/inspect")
    def setup_inspect(body: dict) -> dict:
        """Reads a candidate en.json and reports what it found. Writes NOTHING — the
        live validation behind the path box. Seeing that the tool understood your
        catalogue is what proves the path is right before an hour of engine time
        proves it was not."""
        path = str(body.get("path") or "").strip().strip("\"'")
        if not path:
            raise HTTPException(400, "give me the path to your en.json")
        try:
            plan = plan_init(path)
        except (FileNotFoundError, ValueError) as e:
            raise HTTPException(400, str(e)) from e
        locales = []
        for code in plan["existingTargets"]:
            target = Path(plan["localesDir"]) / f"{code}.json"
            flat = (flatten(json.loads(target.read_text(encoding="utf-8")))
                    if target.exists() else {})
            done = sum(1 for k in plan["sourceFlat"]
                       if isinstance(flat.get(k), str) and flat[k] != "")
            locales.append({"code": code, "done": done, "total": plan["keyCount"],
                            "missing": plan["keyCount"] - done})
        return {
            "ok": True,
            "source": plan["localesDir"], "sourceLanguage": plan["sourceLanguage"],
            "keyCount": plan["keyCount"], "placeholder": plan["placeholder"],
            "pluralSeparator": plan["pluralSeparator"],
            # NOT pre-selected: an existing file is a fact about the folder, not a
            # decision about what to run.
            "locales": locales,
            "candidates": plan["candidates"],
            "configPath": plan["configPath"],
            "exists": Path(plan["configPath"]).exists(),
            "gitignore": gitignore_lines(),
        }

    @router.post("/setup/save")
    def setup_save(body: dict) -> dict:
        """Writes the config and LOADS it, so the page goes live without a restart.
        Editing an existing project comes through here too, and the MERGE is the
        important part: whatever the file already had that this screen does not manage
        is preserved — the UI is a writer, never an owner."""
        path = str(body.get("path") or "").strip().strip("\"'")
        if not path:
            raise HTTPException(400, "give me the path to your en.json")
        try:
            plan = plan_init(
                path,
                targets=body.get("targets") if isinstance(body.get("targets"), list) else None,
                context=body.get("context") if isinstance(body.get("context"), str) else None,
                glossary=body.get("glossary") if isinstance(body.get("glossary"), list) else None,
            )
        except (FileNotFoundError, ValueError) as e:
            raise HTTPException(400, str(e)) from e
        config_path = Path(plan["configPath"])
        existing = (json.loads(config_path.read_text(encoding="utf-8"))
                    if config_path.exists() else {})
        write_init({**plan, "cfg": {**existing, **plan["cfg"]}}, force=True)
        ws.load(config_path)
        return {"ok": True, "configPath": str(config_path), "langs": ws.project.targets}

    @router.get("/server-auth")
    def get_server_auth() -> dict:
        """The headless lock (Settings → Server): bearer tokens gating /v1/* when
        the server runs exposed. Off (empty) by default; reading/writing this
        endpoint is itself gated once tokens exist — loopback stays exempt unless
        requireForLoopback is set, so the local user can never lock themselves out."""
        from .auth import read_auth

        tokens, require = read_auth()
        return {"tokens": tokens, "requireForLoopback": require}

    @router.put("/server-auth")
    def put_server_auth(body: dict) -> dict:
        tokens = body.get("tokens")
        if not isinstance(tokens, list) or not all(isinstance(t, str) for t in tokens):
            raise HTTPException(400, "tokens must be a list of strings")
        cfg = {"tokens": [t for t in tokens if t.strip()],
               "requireForLoopback": bool(body.get("requireForLoopback"))}
        appmeta.set_setting("auth", json.dumps(cfg))
        return cfg

    @router.get("/reviewer")
    def get_reviewer_route() -> dict:
        return {"reviewer": appmeta.get_reviewer()}

    @router.put("/reviewer")
    def put_reviewer(body: dict) -> dict:
        r = body.get("reviewer")
        if r is not None and not isinstance(r, str):
            raise HTTPException(400, "reviewer must be a string or null")
        appmeta.set_reviewer(r)
        return {"reviewer": appmeta.get_reviewer()}

    # ── the project surface ──────────────────────────────────────────────────────

    @router.get("/state")
    def state() -> dict:
        p = project()
        return {
            "langs": p.targets, "source": p.cfg.get("sourceLanguage"),
            "job": ws.jobs.status(),
            "progress": {lg: review_progress(p.state, lg) for lg in p.targets},
            "proposals": {lg: proposal_count(p.state, lg) for lg in p.targets},
        }

    @router.get("/rows")
    def rows(lang: str | None = None) -> dict:
        project()
        return ws.build_rows(lang)

    @router.get("/summary")
    def summary() -> dict:
        """The dashboard's one call: per-language done/total, findings, review state
        and the last run — light enough to refresh after every job. Counts only;
        /rows is the page that carries the strings."""
        from .state import run_history

        p = project()
        langs = []
        for lg in p.targets:
            target_flat = p.target_flat(lg) or {}
            _t, findings, accepted = ws.findings_for(lg)
            statuses = review_statuses(p.state, lg)
            translated = {k for k in p.src
                          if isinstance(target_flat.get(k), str) and target_flat[k] != ""}
            # Findings are about TRANSLATED content — a key with no translation yet
            # is backlog (total - done), not a defect; counting it both ways made
            # the header shout "36 findings" over rows saying "not yet translated".
            flagged = {f["key"] for f in findings if f["key"] in translated}
            done = len(translated)
            unreviewed = sum(1 for k in flagged
                             if (statuses.get(k) or {}).get("status") != "reviewed")
            runs_ = run_history(p.state, lang=lg, limit=1)
            langs.append({
                "code": lg, "total": len(p.src), "done": done,
                "findings": len(flagged), "unreviewed": unreviewed,
                "accepted": len(accepted),
                "staged": proposal_count(p.state, lg),
                "lastRun": runs_[0] if runs_ else None,
            })
        return {"source": p.cfg.get("sourceLanguage"), "keyCount": len(p.src),
                "configPath": str(p.config_path), "langs": langs,
                "job": ws.jobs.status()}

    @router.get("/accepted")
    def accepted_list(lang: str | None = None) -> dict:
        p = project()
        lg = lang or p.targets[0]
        entries = load_accepted(p.paths.accepted_file(lg))
        return {"lang": lg,
                "entries": [{"hash": h, **e} for h, e in entries.items()]}

    @router.post("/save")
    def save(body: dict) -> dict:
        p = project()
        lang, key, value = body.get("lang"), body.get("key"), body.get("value")
        if not all(isinstance(x, str) for x in (lang, key, value)):
            raise HTTPException(400, "lang, key and value must be strings")
        if key not in p.src:
            raise HTTPException(404, f"no such key: {key}")
        prev = (p.target_flat(lang) or {}).get(key)
        ws.write_key(lang, key, value)
        record_action(p.state, lang=lang, key=key, kind="edit", prev=prev, next_value=value)
        set_review_status(p.state, lang=lang, key=key, status="reviewed")
        flags = [{"code": f["code"], "detail": f["detail"]} for f in check_one(
            key=key, src=p.src[key], dst=value,
            ctx=build_context(p.cfg, p.conventions, lang))]
        return {"key": key, "lang": lang, "flags": flags}

    @router.post("/accept")
    def accept(body: dict) -> dict:
        """Records findings as reviewed-and-correct. BULK IS THE POINT: a fresh
        catalogue raises ~70 `untranslated` findings that are almost all correct
        output, and seventy clicks is what makes someone reach for a script — making
        the honest path cheap is what stops that. ONE CALL IS ONE UNDO: the batch
        records a single bulk-accept holding every hash it added. `by` comes from the
        app's reviewer setting — never the OS username."""
        p = project()
        lang = body.get("lang")
        key, keys = body.get("key"), body.get("keys")
        wanted = keys if isinstance(keys, list) else ([key] if key is not None else None)
        if not isinstance(lang, str) or not wanted or not all(isinstance(k, str) for k in wanted):
            raise HTTPException(400, "lang and keys[] (or key) must be strings")
        missing = [k for k in wanted if k not in p.src]
        if missing:
            raise HTTPException(404, f"no such key: {', '.join(missing)}")

        target_flat = p.target_flat(lang) or {}
        wanted_set = set(wanted)
        # Re-run the checks WITHOUT the acceptance filter: accepting is about what the
        # checks currently say, and filtering first makes a second accept a silent no-op.
        raw = [f for f in run_checks(source_flat=p.src, target_flat=target_flat,
                                     ctx=build_context(p.cfg, p.conventions, lang))
               if f["key"] in wanted_set]
        path = p.paths.accepted_file(lang)
        store = load_accepted(path)
        by = appmeta.get_reviewer() or ""
        added = []
        for f in raw:
            entry = acceptance_entry(key=f["key"], code=f["code"],
                                     src=p.src.get(f["key"], ""),
                                     dst=target_flat.get(f["key"], ""), by=by)
            h = acceptance_hash(key=f["key"], code=f["code"],
                                src=entry["src"], dst=entry["dst"])
            if h not in store:
                added.append(h)
            store[h] = entry
        save_accepted(path, store)

        bulk = len(wanted) > 1
        record_action(p.state, lang=lang, key=None if bulk else wanted[0],
                      kind="bulk-accept" if bulk else "accept",
                      prev=added, next_value=wanted if bulk else None)
        for k in wanted:
            set_review_status(p.state, lang=lang, key=k, status="reviewed")
            # A machine's opinion has served its purpose once a human has ruled.
            drop_confirmation(p.state, lang=lang, key=k)
        return {"lang": lang, "keys": wanted, "recorded": len(added), "by": by or None}

    @router.delete("/accept")
    def unaccept(body: dict) -> dict:
        """The fix for the complaint that started the Node rebuild: an acceptance was
        one-way, and accepted keys vanished from the page, so a decision could never
        be revisited."""
        p = project()
        lang, key, code = body.get("lang"), body.get("key"), body.get("code")
        if not isinstance(lang, str) or not isinstance(key, str):
            raise HTTPException(400, "lang and key must be strings")
        path = p.paths.accepted_file(lang)
        store = load_accepted(path)
        removed = {h: e for h, e in store.items()
                   if e["key"] == key and (code is None or e["code"] == code)}
        for h in removed:
            del store[h]
        save_accepted(path, store)
        record_action(p.state, lang=lang, key=key, kind="unaccept", prev=removed)
        return {"key": key, "lang": lang, "removed": len(removed)}

    @router.post("/undo")
    def undo(body: dict) -> dict:
        p = project()
        a = pop_action(p.state, lang=body.get("lang"))
        if a is None:
            raise HTTPException(404, "nothing to undo")
        if a["kind"] == "edit":
            # None, not "" — a key that had no translation goes back to none.
            ws.write_key(a["lang"], a["key"], a["prev"])
        elif a["kind"] in ("accept", "bulk-accept"):
            # Identical reversal for both: prev is the hashes THIS action added, so
            # undoing a 70-key approval is one step and never touches an acceptance
            # that predates the click.
            path = p.paths.accepted_file(a["lang"])
            store = load_accepted(path)
            for h in a["prev"] or []:
                store.pop(h, None)
            save_accepted(path, store)
        elif a["kind"] == "unaccept":
            path = p.paths.accepted_file(a["lang"])
            save_accepted(path, {**load_accepted(path), **(a["prev"] or {})})
        elif a["kind"] == "note":
            ws.write_note(a["lang"], a["key"], a["prev"])
        elif a["kind"] in ("apply", "bulk-apply"):
            # Applying a proposal WRITES the locale file, so undo has to put the old
            # text back — exactly what `edit` does. Until 2026-08-03 there was no branch
            # here at all: `apply` fell through every clause and undo returned its
            # cheerful {"undone": …} having changed nothing on disk. `bulk-apply` carries
            # a {key: prevValue} map (one click, one undo); the legacy single `apply`
            # action carries one scalar prev, and state files written before the change
            # still contain those, so both shapes are restored.
            if a["kind"] == "bulk-apply":
                for key, prev in (a["prev"] or {}).items():
                    ws.write_key(a["lang"], key, prev)
            else:
                ws.write_key(a["lang"], a["key"], a["prev"])
        return {"undone": a}

    @router.get("/history")
    def history(lang: str | None = None) -> dict:
        return {"actions": action_history(project().state, lang=lang)}

    @router.get("/proposals")
    def proposals_list(lang: str | None = None, key: str | None = None) -> dict:
        p = project()
        lg = lang or p.targets[0]
        return {"lang": lg, "proposals": proposals(p.state, lang=lg, key=key)}

    @router.post("/proposals/apply")
    def proposals_apply(body: dict) -> dict:
        p = project()
        lang, keys = body.get("lang"), body.get("keys")
        if not isinstance(lang, str) or not isinstance(keys, list):
            raise HTTPException(400, "lang and keys[] required")
        # ONE undo for the whole click — the bulk-accept promise, applied to writes. A
        # run stages one proposal per key, so "apply what the run produced" is a
        # 2,000-key action; 2,000 undo entries would make the one thing you want after
        # a bad run — put it back — unreachable. `prev` is the map this action
        # overwrote, and it is what undo restores.
        current = p.target_flat(lang) or {}
        applied: list[str] = []
        prev_map: dict[str, str | None] = {}
        for key in keys:
            rows_ = proposals(p.state, lang=lang, key=key)
            if not rows_:
                continue
            prev_map[key] = current.get(key)
            ws.write_key(lang, key, rows_[0]["value"])
            drop_proposal(p.state, lang=lang, key=key)
            applied.append(key)
        if applied:
            record_action(p.state, lang=lang, kind="bulk-apply", prev=prev_map,
                          key=applied[0] if len(applied) == 1 else None)
        return {"lang": lang, "applied": applied}

    @router.delete("/proposals")
    def proposals_discard(body: dict) -> dict:
        p = project()
        lang, keys = body.get("lang"), body.get("keys")
        if not isinstance(lang, str):
            raise HTTPException(400, "lang required")
        if keys is None:
            return {"lang": lang, "discarded": drop_all_proposals(p.state, lang)}
        for key in keys:
            drop_proposal(p.state, lang=lang, key=key)
        return {"lang": lang, "discarded": len(keys)}

    @router.get("/siblings")
    def siblings(key: str, lang: str | None = None) -> dict:
        """How characterAudit.why was actually proven a defect: its sibling renders the
        same label-with-colon pattern correctly. A reviewer needs that view."""
        p = project()
        lg = lang or p.targets[0]
        ns = key.rsplit(".", 1)[0] if "." in key else ""
        target_flat = p.target_flat(lg) or {}
        sibs = [{"key": k, "source": p.src[k], "target": target_flat.get(k, "")}
                for k in p.src
                if k != key and k.startswith(f"{ns}.")
                and "." not in k[len(ns) + 1:]][:25]
        return {"key": key, "namespace": ns, "siblings": sibs}

    @router.get("/terms")
    def terms_route(lang: str | None = None, key: str | None = None,
                    term: str | None = None) -> dict:
        p = project()
        lg = lang or p.targets[0]
        target_flat = p.target_flat(lg) or {}
        if term:
            return {"term": term,
                    "usage": term_usage(source_flat=p.src, target_flat=target_flat,
                                        term=term)}
        if not key:
            raise HTTPException(400, "key or term required")
        index = check_terms(source_flat=p.src, target_flat=target_flat)["index"]
        return {"key": key,
                "findings": check_key_terms(key=key, src=p.src.get(key, ""),
                                            dst=target_flat.get(key), index=index)}

    @router.put("/notes")
    def put_note(body: dict) -> dict:
        p = project()
        lang, key = body.get("lang"), body.get("key")
        note = body.get("note") or None
        if not isinstance(lang, str) or not isinstance(key, str):
            raise HTTPException(400, "lang and key required")
        prev = flatten(p.read_notes(lang)).get(key)
        ws.write_note(lang, key, note)
        record_action(p.state, lang=lang, key=key, kind="note", prev=prev, next_value=note)
        return {"lang": lang, "key": key, "note": note}

    @router.get("/runs")
    def runs(lang: str | None = None) -> dict:
        from .state import run_history

        return {"runs": run_history(project().state, lang=lang)}

    @router.get("/reference")
    def reference(key: str, lang: str | None = None, engine: str = "backtranslate") -> dict:
        p = project()
        lg = lang or p.targets[0]
        return {"key": key, "lang": lg, "engine": engine,
                "cached": get_reference(p.state, lang=lg, key=key, engine=engine)}

    @router.post("/backtranslate")
    def backtranslate(body: dict) -> dict:
        """The target string rendered BACK into the source language, through the
        "review" feature's preset. It answers what no other layer can: "what does this
        actually say?" — the difference between judging a translation and taking its
        word for it. It does NOT catch everything (measured: a correct and an incorrect
        rendering back-translated to the SAME English because the ambiguity was in the
        source). Read-only, cached, never written to a catalogue."""
        p = project()
        lang, key = body.get("lang"), body.get("key")
        if not isinstance(lang, str) or not isinstance(key, str):
            raise HTTPException(400, "lang and key required")
        dst = (p.target_flat(lang) or {}).get(key)
        if not dst:
            raise HTTPException(404, f"no translation for {key}")
        cached = get_reference(p.state, lang=lang, key=key, engine="backtranslate")
        if cached:
            return {"key": key, "lang": lang, "english": cached["value"], "cached": True}
        source_lang = p.cfg.get("sourceLanguage", "en")
        system = (f"You are a translator, {lang}→{source_lang}. Translate the text "
                  "literally, preserving any {placeholders} exactly. Output ONLY JSON "
                  "matching the schema.")
        try:
            send = make_send("review")
            out = send(system, f'Translate items: {json.dumps([{"id": 0, "text": dst}])}')
            english = parse_items(out).get(0)
        except (EngineNotConfigured, RuntimeError, ValueError) as e:
            # A dead second opinion must never block reviewing.
            raise HTTPException(502, str(e)) from e
        if not english:
            raise HTTPException(502, "the engine returned nothing usable")
        put_reference(p.state, lang=lang, key=key, engine="backtranslate", value=english)
        return {"key": key, "lang": lang, "english": english, "cached": False}

    # ── jobs ─────────────────────────────────────────────────────────────────────

    @router.post("/jobs", status_code=202)
    def start_job(body: dict) -> dict:
        p = project()
        lang = body.get("lang")
        scope = body.get("scope", "flagged")
        keys = body.get("keys")
        preset_id = body.get("presetId")
        if lang not in p.targets:
            raise HTTPException(400, f"unknown language: {lang}")
        if scope not in SCOPES:
            raise HTTPException(
                400, f"unknown scope: {scope}. Use one of {', '.join(sorted(SCOPES))}")
        if ws.jobs.busy:
            raise HTTPException(409, "a job is already running")

        if scope == "keys":
            wanted = keys or []
        elif scope == "all":
            wanted = list(p.src)
        else:
            _t, findings, _a = ws.findings_for(lang)
            wanted = sorted({f["key"] for f in findings
                             if scope != "unsure" or f["code"] == "disagreement"})
            if scope == "pending":
                tflat = p.target_flat(lang) or {}
                wanted = sorted(set(wanted) | {
                    k for k in p.src
                    if not (isinstance(tflat.get(k), str) and tflat[k] != "")})
        subset = {k: p.src[k] for k in wanted if k in p.src}
        if not subset:
            raise HTTPException(400, "that scope selected no keys")

        # THE two-resolver fix, structural now: the job resolves through the SAME seam
        # the CLI uses. presetId is the escalate-from-the-page door.
        try:
            send = make_send("translate", preset_id=preset_id)
        except EngineNotConfigured as e:
            raise HTTPException(400, str(e)) from e
        cfg = {**p.cfg,
               "conventionsLine": (p.conventions.get(lang) or {}).get("promptLine", ""),
               # notes MUST be here: the note a reviewer writes on a key is sent when
               # they press re-translate on that same key — the one place it matters.
               "notes": flatten(p.read_notes(lang))}
        try:
            status = ws.jobs.start(lang=lang, engine=preset_id or "translate",
                                   send=send, scope=scope, subset=subset, cfg=cfg,
                                   cache_path=p.paths.cache_path)
        except JobBusyError as e:
            raise HTTPException(409, str(e)) from e
        return {"job": status}

    @router.get("/jobs/current")
    def job_current() -> dict:
        project()
        return {"job": ws.jobs.status()}

    @router.post("/jobs/cancel")
    def job_cancel() -> dict:
        project()
        return {"job": ws.jobs.cancel()}

    @router.get("/jobs/stream")
    def job_stream(request: Request) -> StreamingResponse:
        """Server-sent events for a running job. The subscription is a queue the
        manager's plain-callback subscriber feeds — transport stays out of jobs.py."""
        project()
        q: queue.Queue = queue.Queue()
        off = ws.jobs.subscribe(q.put)

        def gen():
            try:
                yield f"event: hello\ndata: {json.dumps(ws.jobs.status())}\n\n"
                while True:
                    try:
                        e = q.get(timeout=15)
                    except queue.Empty:
                        yield ": keepalive\n\n"
                        continue
                    yield f"event: {e['type']}\ndata: {json.dumps(e)}\n\n"
                    if e["type"] == "done":
                        break
            finally:
                off()

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"cache-control": "no-cache"})

    # ── the Google Translate frame ───────────────────────────────────────────────

    @router.get("/gt-frame", response_class=HTMLResponse)
    def gt_frame(text: str = "", tl: str = "es") -> str:
        """The minimal page the Google Translate widget runs in — the widget translates
        the WHOLE document it is loaded into, so a page containing nothing but the
        string is what makes it usable. Same-origin, so the parent reads the result."""
        esc = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>gt</title>
<style> body {{ font: 15px/1.5 system-ui, sans-serif; margin: 8px; color-scheme: light dark; }}
 #src {{ padding: 8px; border-radius: 6px; }}</style></head><body>
<div id="google_translate_element"></div>
<div id="src">{esc}</div>
<script>
 window.__tl = {json.dumps(tl)};
 function googleTranslateElementInit() {{ new google.translate.TranslateElement({{ pageLanguage: 'en' }}, 'google_translate_element'); }}
</script>
<script src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
</body></html>"""

    return router
