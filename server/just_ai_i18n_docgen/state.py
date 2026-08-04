# SPDX-License-Identifier: MIT
"""Project state — everything the tool remembers about ONE app, in one JSON file.

Ported from just-ai-help's `server/state.js`, reasoning intact:

WHAT IS AND IS NOT IN HERE. `.jah-state.json` is gitignored and holds only what a re-run
can rebuild: the review cursor, the undo log, staged proposals, confirmation verdicts,
cached second opinions, run history. Delete it and you lose your place in a review, never
your work. The committed human record (`config.json`, `<lang>.accepted.json`,
`<lang>.notes.json`) lives in the TRANSLATED app's repo — the 2026-08-01 ruling. Machine
state (providers, keys, presets) lives in the shared LLM stack's DB. This file is the
third thing: per-project workshop state.

CONCURRENCY. A CLI run and an open review page can both write. Every mutation RE-READS
the file, applies its change and writes atomically (temp file + rename), so the window
for a lost update is one mutation rather than one process lifetime. It is not a lock,
and this docstring says so rather than implying safety that is not here.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
from pathlib import Path

STATE_FILE = ".jah-state.json"
STATE_VERSION = 1

# The mutations an undo has to be able to reverse. A `bulk-` kind is ONE action over
# many keys, so a batch stays one click and one undo (`prev` is a {key: value} map).
ACTION_KINDS = ["edit", "accept", "unaccept", "apply", "discard", "note",
                "bulk-accept", "bulk-apply"]


def _now() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat()


def _empty() -> dict:
    return {
        "version": STATE_VERSION,
        "review": {},
        "actions": [],
        "nextActionId": 1,
        "proposals": {},
        "confirmations": {},
        "references": {},
        "runs": [],
        "nextRunId": 1,
    }


def write_json_atomic(path: str | Path, value) -> None:
    """Temp file + `os.replace` — atomic on both Windows and POSIX, so a crash mid-write
    leaves the previous file intact rather than a truncated one. Whole-file JSON writes
    without this are how a cache gets corrupted, and a corrupted cache is what cost 27
    minutes and 464 hand-corrected keys."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    try:
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def read_json_safe(path: str | Path, fallback):
    """A JSON file, or `fallback` for missing OR corrupt. A corrupt file costs state,
    never work."""
    p = Path(path)
    if not p.exists():
        return fallback
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return fallback


class JsonStore:
    """A handle over one JSON file. `mutate` re-reads before applying, so a change made
    by the other process between this handle's last read and now is not silently
    discarded."""

    def __init__(self, path: str | Path, empty=_empty):
        self.path = Path(path)
        self.empty = empty
        self.data = read_json_safe(self.path, None) or empty()

    def read(self) -> dict:
        self.data = read_json_safe(self.path, None) or self.empty()
        return self.data

    def mutate(self, fn):
        d = self.read()
        out = fn(d)
        write_json_atomic(self.path, d)
        return out


def open_project(project_root: str | Path) -> JsonStore:
    """The state file for one project. `project_root` is the config's own folder."""
    return JsonStore(Path(project_root) / STATE_FILE)


# ── Review progress ──────────────────────────────────────────────────────────────────


def set_review_status(s: JsonStore, *, lang: str, key: str, status: str | None) -> None:
    """'reviewed' | 'skipped' | None, where None means "seen but undecided" — visiting a
    key must not silently count as approving it."""
    def fn(d):
        d["review"].setdefault(lang, {})[key] = {"status": status, "visitedAt": _now()}
    s.mutate(fn)


def review_statuses(s: JsonStore, lang: str) -> dict:
    all_ = s.read()["review"].get(lang, {})
    return {k: v for k, v in all_.items() if v.get("status") is not None}


def review_progress(s: JsonStore, lang: str) -> dict:
    out = {"reviewed": 0, "skipped": 0}
    for v in s.read()["review"].get(lang, {}).values():
        if v.get("status") in out:
            out[v["status"]] += 1
    return out


# ── The action log ───────────────────────────────────────────────────────────────────


def record_action(s: JsonStore, *, lang: str, kind: str, prev, key: str | None = None,
                  next_value=None) -> int:
    """Records one reversible mutation. `prev` is the whole point: it is what undo
    restores. A caller passing nothing for it is recording something it cannot reverse
    — a bug in the caller — so this raises rather than quietly logging an action that
    will fail when someone presses undo six days later. (Python has no `undefined`; the
    sentinel is required-keyword with no default.)"""
    if kind not in ACTION_KINDS:
        raise ValueError(f"unknown action kind: {kind}")

    def fn(d):
        action_id = d["nextActionId"]
        d["nextActionId"] += 1
        d["actions"].append({
            "id": action_id, "lang": lang, "key": key, "kind": kind,
            "prev": prev, "next": next_value, "at": _now(), "undone": False,
        })
        return action_id

    return s.mutate(fn)


def last_action(s: JsonStore, lang: str | None = None) -> dict | None:
    for a in reversed(s.read()["actions"]):
        if a["undone"]:
            continue
        if lang and a["lang"] != lang:
            continue
        return a
    return None


def action_history(s: JsonStore, *, lang: str | None = None, limit: int = 50) -> list[dict]:
    acts = [a for a in s.read()["actions"] if not lang or a["lang"] == lang]
    return list(reversed(acts[-limit:]))


def pop_action(s: JsonStore, *, lang: str | None = None) -> dict | None:
    """Marks an action undone and returns it, so the caller can put `prev` back where it
    came from. This module does NOT perform the reversal: undoing an edit writes a locale
    file and undoing an accept rewrites the accepted file — both belong to the code that
    owns those files. Keeping the log ignorant of them is what stops it becoming a
    second, competing writer."""
    def fn(d):
        for a in reversed(d["actions"]):
            if a["undone"]:
                continue
            if lang and a["lang"] != lang:
                continue
            a["undone"] = True
            return a
        return None

    return s.mutate(fn)


# ── Proposals ────────────────────────────────────────────────────────────────────────


def put_proposal(s: JsonStore, *, lang: str, key: str, engine: str, value: str) -> None:
    """Stages engine output. NOTHING here reaches a locale file until a human applies it
    — the governing principle of the whole design; it is what makes a 50-minute bulk run
    safe to cancel and a placeholder-mangling result harmless."""
    def fn(d):
        d["proposals"].setdefault(lang, {}).setdefault(key, {})[engine] = {
            "value": value, "at": _now(),
        }
    s.mutate(fn)


def proposals(s: JsonStore, *, lang: str, key: str | None = None) -> list[dict]:
    for_lang = s.read()["proposals"].get(lang, {})
    keys = [key] if key and key in for_lang else (sorted(for_lang) if key is None else [])
    out = []
    for k in keys:
        for engine, v in for_lang[k].items():
            out.append({"lang": lang, "key": k, "engine": engine,
                        "value": v["value"], "at": v["at"]})
    return sorted(out, key=lambda r: r["at"], reverse=True)


def proposal_keys(s: JsonStore, lang: str) -> set[str]:
    return set(s.read()["proposals"].get(lang, {}))


def proposal_count(s: JsonStore, lang: str) -> int:
    return len(s.read()["proposals"].get(lang, {}))


def drop_proposal(s: JsonStore, *, lang: str, key: str, engine: str | None = None) -> None:
    def fn(d):
        for_key = d["proposals"].get(lang, {}).get(key)
        if not for_key:
            return
        if engine:
            for_key.pop(engine, None)
        else:
            del d["proposals"][lang][key]
            return
        if not for_key:
            del d["proposals"][lang][key]
    s.mutate(fn)


def drop_all_proposals(s: JsonStore, lang: str) -> int:
    def fn(d):
        n = len(d["proposals"].get(lang, {}))
        d["proposals"].pop(lang, None)
        return n
    return s.mutate(fn)


# ── Confirmation verdicts ────────────────────────────────────────────────────────────
# A verdict is workshop state, NOT a decision: it never turns a check green on its own.
# It pre-sorts the pile so a human can approve the obvious ones in one click. `hash` is
# over (key, code, src, dst) so a verdict expires the moment either string changes — the
# same rule an acceptance follows.


def put_confirmation(s: JsonStore, *, lang: str, key: str, hash: str, verdict: str,
                     engine: str, suggestion: str | None = None) -> None:
    if verdict not in ("same", "translate"):
        raise ValueError(f"unknown verdict: {verdict}")

    def fn(d):
        d["confirmations"].setdefault(lang, {})[key] = {
            "hash": hash, "verdict": verdict, "suggestion": suggestion,
            "engine": engine, "at": _now(),
        }
    s.mutate(fn)


def confirmations(s: JsonStore, lang: str) -> dict:
    """Verdicts for a language, keyed by key. Callers check `hash` before trusting one."""
    return s.read()["confirmations"].get(lang, {})


def drop_confirmation(s: JsonStore, *, lang: str, key: str) -> None:
    def fn(d):
        d["confirmations"].get(lang, {}).pop(key, None)
    s.mutate(fn)


# ── Reference cache ──────────────────────────────────────────────────────────────────


def put_reference(s: JsonStore, *, lang: str, key: str, engine: str, value: str) -> None:
    def fn(d):
        d["references"].setdefault(lang, {}).setdefault(key, {})[engine] = {
            "value": value, "at": _now(),
        }
    s.mutate(fn)


def get_reference(s: JsonStore, *, lang: str, key: str, engine: str):
    return s.read()["references"].get(lang, {}).get(key, {}).get(engine)


def drop_references(s: JsonStore, *, lang: str, key: str) -> None:
    """Called when a key's translation changes, so stale advice cannot linger."""
    def fn(d):
        d["references"].get(lang, {}).pop(key, None)
    s.mutate(fn)


# ── Runs ─────────────────────────────────────────────────────────────────────────────
# "How did this catalogue get here" — two full catalogue runs in July 2026 were
# unreproducible because nothing recorded what produced them.


def start_run(s: JsonStore, *, lang: str, engine: str, scope: str) -> int:
    def fn(d):
        run_id = d["nextRunId"]
        d["nextRunId"] += 1
        d["runs"].append({
            "id": run_id, "lang": lang, "engine": engine, "scope": scope,
            "keys": 0, "requests": 0, "elapsedMs": 0, "failed": 0,
            "startedAt": _now(), "finishedAt": None,
        })
        return run_id
    return s.mutate(fn)


def finish_run(s: JsonStore, run_id: int, *, keys: int = 0, requests: int = 0,
               elapsed_ms: int = 0, failed: int = 0) -> None:
    def fn(d):
        for r in d["runs"]:
            if r["id"] == run_id:
                r.update(keys=keys, requests=requests, elapsedMs=elapsed_ms,
                         failed=failed, finishedAt=_now())
    s.mutate(fn)


def run_history(s: JsonStore, *, lang: str | None = None, limit: int = 20) -> list[dict]:
    runs = [r for r in s.read()["runs"] if not lang or r["lang"] == lang]
    return list(reversed(runs[-limit:]))
