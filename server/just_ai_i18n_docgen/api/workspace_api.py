# SPDX-License-Identifier: MIT
"""The review workspace API — the project surface, jobs, and the GT frame.

Routes live at /v1 like every family route — JW and JV put their OWN app routes
under /v1 beside the shared stack's; /api was a Node-era habit, corrected
2026-08-02. The write rules the handlers obey (WHAT WRITES WHAT) are the
Workspace class's contract — see workspace.py's module docstring.

The server starts WITHOUT a project — the setup screen (setup_api.py) has to be
reachable before a config exists. Routes needing one get a 409 with `needsSetup`
from one dependency (`project()` below), not a change to every handler. Loading
REPLACES the project wholesale; there is no swap-while-running path, because a
half-swapped project with a job in flight is a bug waiting to be written.
"""

from __future__ import annotations

import json
import queue

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse

from .. import appmeta
from ..accepted import acceptance_entry, acceptance_hash, load_accepted, save_accepted
from ..app_state import get_state
from ..checks import build_context, check_one
from ..confirm import CONFIRM_CODE, confirm_identical, make_ask
from ..engine import EngineNotConfigured, make_send
from ..jobs import JobBusyError
from ..jsonio import flatten
from ..service import Project, unfiltered_findings
from ..shieldlib import parse_items
from ..state import (
    action_history,
    drop_all_proposals,
    drop_confirmation,
    drop_proposal,
    get_reference,
    pop_action,
    proposal_count,
    proposals,
    put_confirmation,
    put_proposal,
    put_reference,
    record_action,
    review_progress,
    review_statuses,
    run_history,
    set_review_status,
)
from ..terms import check_key_terms, check_terms, term_usage
from ..workspace import (
    _UNLIMITED,
    _glossary_list,
    _pick_preview_lang,
    _preview_confirm,
    _preview_translate,
)

# The only scopes a run may have. Anything else is a typo, and a typo must not start a
# job — found by driving the real catalogue: an unrecognised scope fell through to the
# flagged branch and started a 154-key run. `pending` is the dashboard's button: keys
# with no translation at all PLUS flagged ones — `flagged` alone selects nothing on a
# fresh language, because a key that is missing has no finding to flag.
SCOPES = {"flagged", "unsure", "all", "keys", "pending"}

router = APIRouter(tags=["workspace"])


def project() -> Project:
    ws = get_state().workspace
    if ws.project is None:
        raise HTTPException(status_code=409,
                            detail={"error": "no project loaded yet", "needsSetup": True})
    # Every project route passes here — the one seam where an externally
    # changed en.json (CLI extract, git, an editor) gets picked up.
    ws.project.refresh_source_if_changed()
    return ws.project


# ── the project surface ──────────────────────────────────────────────────────


@router.get("/v1/state")
def state() -> dict:
    ws = get_state().workspace
    p = project()
    return {
        "langs": p.targets, "source": p.cfg.get("sourceLanguage"),
        "job": ws.jobs.status(),
        "progress": {lg: review_progress(p.state, lg) for lg in p.targets},
        "proposals": {lg: proposal_count(p.state, lg) for lg in p.targets},
    }


@router.post("/v1/ai/prompt-preview")
def prompt_preview(body: dict) -> dict:
    """The family contract for pipeline-owned prompts (app-structure.md): the kit's
    promptless Lab POSTs {feature, lang?, keys?} and renders the REAL generated
    prompt read-only. Loud named 400s; 409 needsSetup like every project route."""
    p = project()
    feature = str(body.get("feature") or "")
    lang = str(body.get("lang") or "") or _pick_preview_lang(p, feature)
    if not lang:
        raise HTTPException(400, "No target languages configured — add one in Setup.")
    keys = body.get("keys") or None
    if feature == "translate":
        return _preview_translate(p, lang, keys)
    if feature == "confirm":
        return _preview_confirm(p, lang, keys)
    raise HTTPException(
        400, f'No prompt preview for "{feature}" yet — routing still picks its '
             "engine preset.")


@router.get("/v1/rows")
def rows(lang: str | None = None) -> dict:
    project()
    return get_state().workspace.build_rows(lang)


@router.get("/v1/summary")
def summary() -> dict:
    """The dashboard's one call: per-language done/total, findings, review state
    and the last run — light enough to refresh after every job. Counts only;
    /rows is the page that carries the strings."""
    ws = get_state().workspace
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


@router.get("/v1/accepted")
def accepted_list(lang: str | None = None) -> dict:
    p = project()
    lg = lang or p.targets[0]
    entries = load_accepted(p.paths.accepted_file(lg))
    return {"lang": lg,
            "entries": [{"hash": h, **e} for h, e in entries.items()]}


@router.post("/v1/save")
def save(body: dict) -> dict:
    ws = get_state().workspace
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


@router.post("/v1/accept")
def accept(body: dict) -> dict:
    """Records findings as reviewed-and-correct. BULK IS THE POINT: a fresh
    catalogue raises ~70 `untranslated` findings that are almost all correct
    output, and seventy clicks is what makes someone reach for a script — making
    the honest path cheap is what stops that. ONE CALL IS ONE UNDO: the batch
    records a single bulk-accept holding every hash it added. `by` comes from the
    app's reviewer setting — never the OS username."""
    ws = get_state().workspace
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
    # Re-run EVERY finding source WITHOUT the acceptance filter: accepting is
    # about what the page currently says, and filtering first makes a second
    # accept a silent no-op. unfiltered_findings carries the advisory
    # (terminology) and suspect findings run_checks alone dropped — accepting
    # those recorded NOTHING and the flag survived (audit 2026-08-05).
    raw = [f for f in unfiltered_findings(p, lang, target_flat, top_n=_UNLIMITED,
                                          include_terms=True,
                                          term_cache=ws.term_cache)
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


@router.delete("/v1/accept")
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


@router.post("/v1/undo")
def undo(body: dict) -> dict:
    ws = get_state().workspace
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
    elif a["kind"] == "bulk-discard":
        # Re-stage what the discard dropped — proposals only, no locale write.
        for r in a["prev"] or []:
            put_proposal(p.state, lang=a["lang"], key=r["key"],
                         engine=r.get("engine") or "engine", value=r["value"])
    return {"undone": a}


@router.get("/v1/history")
def history(lang: str | None = None) -> dict:
    return {"actions": action_history(project().state, lang=lang)}


@router.get("/v1/proposals")
def proposals_list(lang: str | None = None, key: str | None = None) -> dict:
    p = project()
    lg = lang or p.targets[0]
    return {"lang": lg, "proposals": proposals(p.state, lang=lg, key=key)}


@router.post("/v1/proposals/apply")
def proposals_apply(body: dict) -> dict:
    ws = get_state().workspace
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


@router.delete("/v1/proposals")
def proposals_discard(body: dict) -> dict:
    p = project()
    lang, keys = body.get("lang"), body.get("keys")
    if not isinstance(lang, str):
        raise HTTPException(400, "lang required")
    # Discard destroys staged work by hand, so it is UNDOABLE like every other
    # human action (audit 2026-08-05: it recorded nothing — the next undo
    # silently reversed some OLDER action instead). prev holds the dropped
    # rows; undo re-stages them. The count is what was actually dropped,
    # never len(keys) (a key with no proposal is not a discard).
    wanted = None if keys is None else {k for k in keys if isinstance(k, str)}
    dropped = [r for r in proposals(p.state, lang=lang)
               if wanted is None or r["key"] in wanted]
    if wanted is None:
        drop_all_proposals(p.state, lang)
    else:
        for key in wanted:
            drop_proposal(p.state, lang=lang, key=key)
    if dropped:
        record_action(p.state, lang=lang, kind="bulk-discard",
                      prev=[{"key": r["key"], "value": r["value"],
                             "engine": r.get("engine") or "engine"}
                            for r in dropped],
                      key=dropped[0]["key"] if len(dropped) == 1 else None)
    return {"lang": lang, "discarded": len(dropped)}


@router.get("/v1/siblings")
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


@router.get("/v1/terms")
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


@router.put("/v1/notes")
def put_note(body: dict) -> dict:
    ws = get_state().workspace
    p = project()
    lang, key = body.get("lang"), body.get("key")
    note = body.get("note") or None
    if not isinstance(lang, str) or not isinstance(key, str):
        raise HTTPException(400, "lang and key required")
    prev = flatten(p.read_notes(lang)).get(key)
    ws.write_note(lang, key, note)
    record_action(p.state, lang=lang, key=key, kind="note", prev=prev, next_value=note)
    return {"lang": lang, "key": key, "note": note}


@router.get("/v1/runs")
def runs(lang: str | None = None) -> dict:
    return {"runs": run_history(project().state, lang=lang)}


@router.get("/v1/reference")
def reference(key: str, lang: str | None = None, engine: str = "backtranslate") -> dict:
    p = project()
    lg = lang or p.targets[0]
    return {"key": key, "lang": lg, "engine": engine,
            "cached": get_reference(p.state, lang=lg, key=key, engine=engine)}


@router.post("/v1/backtranslate")
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


@router.post("/v1/jobs", status_code=202)
def start_job(body: dict) -> dict:
    ws = get_state().workspace
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
        tflat, findings, _a = ws.findings_for(lang)
        # The ruled semantics (2026-08-05, the original's intent): `flagged` =
        # only CHECKED-AND-FLAGGED keys — a finding on an EXISTING translation.
        # A missing key was never checked, so it belongs to `pending`, never
        # `flagged` (same translated-only filter /summary already applies).
        wanted = sorted({f["key"] for f in findings
                         if f["key"] in tflat
                         and (scope != "unsure" or f["code"] == "disagreement")})
        if scope == "pending":
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

    # The confirmation pass for APP runs (the design's pre-tick, 2026-08-04 —
    # only CLI `translate` ran it before): called by the job worker with the
    # DONE run's byte-identical proposals; the hash carries the STAGED value,
    # so the rows arrive pre-annotated the moment they're applied. Annotations
    # only — the engine never writes <lang>.accepted.json.
    def confirm_pass(identical: dict, *, is_cancelled=None) -> None:
        # One key per call is the pass's own design ("a batch is how the
        # original skip happened") — looping here lets Cancel take effect
        # between keys (the 2026-08-05 confirming-state fix).
        ask = make_ask("confirm")
        by = "engine (confirm preset)"
        for key in sorted(identical):
            if is_cancelled is not None and is_cancelled():
                return
            res = confirm_identical(
                keys=[key], source_flat=p.src, target_flat=identical,
                target_lang=lang, context=p.cfg.get("context", ""),
                do_not_translate=_glossary_list(p.cfg),
                ask=ask,
            )
            for c in res["cleared"]:
                put_confirmation(p.state, lang=lang, key=c["key"],
                                 hash=acceptance_hash(key=c["key"], code=CONFIRM_CODE,
                                                      src=c["src"], dst=c["dst"] or ""),
                                 verdict="same", engine=by)
            for pr in res["proposed"]:
                put_confirmation(p.state, lang=lang, key=pr["key"],
                                 hash=acceptance_hash(key=pr["key"], code=CONFIRM_CODE,
                                                      src=pr["src"], dst=pr["dst"] or ""),
                                 verdict="translate", suggestion=pr["suggestion"],
                                 engine=by)

    try:
        status = ws.jobs.start(lang=lang, engine=preset_id or "translate",
                               send=send, scope=scope, subset=subset, cfg=cfg,
                               cache_path=p.paths.cache_path, confirm=confirm_pass)
    except JobBusyError as e:
        raise HTTPException(409, str(e)) from e
    return {"job": status}


@router.get("/v1/jobs/current")
def job_current() -> dict:
    project()
    return {"job": get_state().workspace.jobs.status()}


@router.post("/v1/jobs/cancel")
def job_cancel() -> dict:
    project()
    return {"job": get_state().workspace.jobs.cancel()}


@router.get("/v1/jobs/stream")
def job_stream(request: Request) -> StreamingResponse:
    """Server-sent events for a running job. The subscription is a queue the
    manager's plain-callback subscriber feeds — transport stays out of jobs.py."""
    ws = get_state().workspace
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


@router.get("/v1/gt-frame", response_class=HTMLResponse)
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
