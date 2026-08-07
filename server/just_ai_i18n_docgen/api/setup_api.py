# SPDX-License-Identifier: MIT
"""/v1/setup/* + /v1/reviewer — the no-project surface.

Setup works with NO project — it is the screen that CREATES one. The reviewer
identity rides here too: the Setup screen asks for it and `/setup/state`
returns it, so a verdict can say who made it (never the OS username).
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import appmeta
from ..app_state import get_state
from ..init import gitignore_lines, plan_init, write_init
from ..jsonio import flatten
from ..workspace import _glossary_list

router = APIRouter(tags=["setup"])


@router.get("/v1/setup/state")
def setup_state() -> dict:
    from importlib import resources

    languages = json.loads(
        resources.files("just_ai_i18n_docgen").joinpath("config/languages.json")
        .read_text(encoding="utf-8"))
    p = get_state().workspace.project
    return {
        "loaded": p is not None,
        "configPath": str(p.config_path) if p else None,
        "source": str(p.paths.source_file) if p else None,
        "langs": p.targets if p else [],
        # Prefill, not decoration: an edit screen that shows blanks over a
        # configured project invites "save" to feel like it erased something.
        "context": (p.cfg.get("context") or "") if p else "",
        # ALWAYS a bare list on the wire: the loaded cfg normalizes a list to
        # {"doNotTranslate": [...]} (infer.py), and handing that dict to the UI
        # blew up the Setup prefill and let a Save erase the real glossary
        # (found by the 2026-08-05 audit — the exact failure this prefill
        # comment says it exists to prevent).
        "glossary": _glossary_list(p.cfg) if p else [],
        "reviewer": appmeta.get_reviewer(),
        # Codes only. The display name is derived in the browser from
        # Intl.DisplayNames, so the menu reads in the user's own language and no
        # English name can go stale here.
        "languages": languages,
    }


@router.post("/v1/setup/inspect")
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


@router.post("/v1/setup/save")
def setup_save(body: dict) -> dict:
    """Writes the config and LOADS it, so the page goes live without a restart.
    Editing an existing project comes through here too, and the MERGE is the
    important part: whatever the file already had that this screen does not manage
    is preserved — the UI is a writer, never an owner."""
    ws = get_state().workspace
    path = str(body.get("path") or "").strip().strip("\"'")
    if not path:
        raise HTTPException(400, "give me the path to your en.json")
    # A field the caller DIDN'T send falls back to the EXISTING config's value,
    # never to plan_init's defaults — the defaults overwrote the real glossary
    # through the merge below (found by the 2026-08-05 audit). The existing file
    # is read for fallbacks BEFORE planning; the merge still preserves every
    # unmanaged key ("the UI is a writer, never an owner").
    body_targets = body.get("targets") if isinstance(body.get("targets"), list) else None
    body_context = body.get("context") if isinstance(body.get("context"), str) else None
    body_glossary = body.get("glossary") if isinstance(body.get("glossary"), list) else None
    try:
        probe = plan_init(path)
        existing_cfg = (json.loads(Path(probe["configPath"]).read_text(encoding="utf-8"))
                        if Path(probe["configPath"]).exists() else {})
        plan = plan_init(
            path,
            targets=body_targets if body_targets is not None
                    else (existing_cfg.get("targets") if isinstance(existing_cfg.get("targets"), list) else None),
            context=body_context if body_context is not None
                    else (existing_cfg.get("context") if isinstance(existing_cfg.get("context"), str) else None),
            glossary=body_glossary if body_glossary is not None
                     else (_glossary_list(existing_cfg) if existing_cfg.get("glossary") is not None else None),
        )
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e)) from e
    config_path = Path(plan["configPath"])
    existing = (json.loads(config_path.read_text(encoding="utf-8"))
                if config_path.exists() else {})
    write_init({**plan, "cfg": {**existing, **plan["cfg"]}}, force=True)
    ws.load(config_path)
    return {"ok": True, "configPath": str(config_path), "langs": ws.project.targets}


@router.get("/v1/reviewer")
def get_reviewer_route() -> dict:
    return {"reviewer": appmeta.get_reviewer()}


@router.put("/v1/reviewer")
def put_reviewer(body: dict) -> dict:
    r = body.get("reviewer")
    if r is not None and not isinstance(r, str):
        raise HTTPException(400, "reviewer must be a string or null")
    appmeta.set_reviewer(r)
    return {"reviewer": appmeta.get_reviewer()}
