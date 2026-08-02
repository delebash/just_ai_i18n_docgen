# SPDX-License-Identifier: MIT
"""Accepted findings — the reviewer's verdict, made durable.

Ported from just-ai-help's `server/accepted.js`. Some findings are correct output, not
defects, and no check refinement will decide that for you: "No" → "No" is correct
Spanish, "General" → "General" is a cognate, and a parenthetical gloss is a judgement
call a human makes once. Across two full runs the `untranslated` check raised 20
findings of which exactly ONE was a real defect. The consequence is worse than noise:
a PERFECT catalogue could never exit 0 — and a gate that cannot go green is not a gate;
people stop reading it, and that is precisely how the next real miss ships.

NOT a per-language list of "words identical in Spanish" — that was the first design and
it was wrong twice over (it only fixed one check, and it meant writing lexical claims
from memory into config, the exact mistake conventions.json warns about, about itself).

An entry is keyed by a content hash of (key, code, source, target), which is the
load-bearing property:

  * Accepting `untranslated` on a key does NOT hide `brackets` on the same key.
  * If the SOURCE changes, the hash changes and the finding comes back. An acceptance is
    a statement about one exact pair of strings, never a standing exemption for a key.
  * If the TARGET changes — someone edits the translation — the finding comes back.

And it is never silent: the count is always reported. Suppression you cannot see is the
bug this whole project was written in response to.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
from pathlib import Path

# "unknown" on purpose, and NOT the OS username: an automated run under a developer's
# account would inherit their name and become indistinguishable from the developer's own
# judgement — the exact failure this field exists to make visible. (It exists because an
# agent once wrote 58 verdicts into a real project's sidecar in bulk, and the format
# could not tell them from a human's review.)
UNKNOWN_REVIEWER = "unknown"


def acceptance_hash(*, key: str, code: str, src: str, dst: str) -> str:
    """The content hash for one finding. Includes the CODE so acceptances are
    per-defect, and both strings so any edit to either side revives the finding.
    NUL-joined so "a|b"+"c" and "a"+"b|c" can never collide — written as the ESCAPE,
    never the literal byte (see checks.py's war story)."""
    joined = f"{key}\x00{code}\x00{src}\x00{dst}"
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()[:16]


def load_accepted(path: str | Path) -> dict:
    """Reads a sidecar, or an empty store if there is none. A corrupt file costs a
    re-review, never a wrong pass — failing toward SHOWING the finding is the only safe
    direction. `_`-prefixed keys are skipped so a file from an older version loads."""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        return {k: v for k, v in raw.items() if not k.startswith("_")}
    except (ValueError, OSError):
        return {}


def save_accepted(path: str | Path, entries: dict) -> None:
    """Writes the file, entries sorted so the diff is stable. Data only — the prose
    about what this file is for lives in the docs, never in the JSON."""
    ordered = dict(sorted(entries.items()))
    Path(path).write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def partition_accepted(
    findings: list[dict], accepted: dict, source_flat: dict, target_flat: dict
) -> tuple[list[dict], list[dict]]:
    """Splits findings into what still counts and what a reviewer has already cleared.
    Cleared findings are RETURNED, never dropped — the caller can always report them."""
    kept: list[dict] = []
    cleared: list[dict] = []
    for f in findings:
        h = acceptance_hash(
            key=f["key"], code=f["code"],
            src=source_flat.get(f["key"], ""), dst=target_flat.get(f["key"], ""),
        )
        if h in accepted:
            cleared.append({**f, "hash": h})
        else:
            kept.append(f)
    return kept, cleared


def acceptance_entry(*, key: str, code: str, src: str, dst: str,
                     by: str = "", at: str = "") -> dict:
    """The stored entry for one finding — readable in a diff, so a reviewer can audit
    what was waved through. `by` and `at` are PROVENANCE and deliberately OUTSIDE the
    hash: the hash identifies the finding; who signed it off is metadata about that
    identity, so re-accepting under a different name updates one entry rather than
    creating a second that suppresses the same thing twice."""
    return {
        "key": key,
        "code": code,
        "src": src,
        "dst": dst,
        "by": by or UNKNOWN_REVIEWER,
        "at": at or _dt.datetime.now(tz=_dt.timezone.utc).date().isoformat(),
    }
