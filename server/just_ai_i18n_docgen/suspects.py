# SPDX-License-Identifier: MIT
"""Layer 2b — the SUSPECT list. What the checks CANNOT see.

Ported from just-ai-help's `server/suspects.js`. The checks are about FORM; a
translation can pass every one and still be wrong — the two worst cases measured
2026-07-28 both did ("delete autosave NUMBER 3" for "delete 3 autosaves", and an
invented noun). A human reading Spanish catches both in seconds, which does not scale
to 846 keys and does not exist at all for a language nobody on the team reads.

THE SIGNAL: self-consistency. Translate the same key twice with the SAME model at
non-zero temperature and compare — where the model is sure it repeats itself, where it
guesses it wanders. Two DIFFERENT models was tried and is WORSE: they word everything
differently, so real defects drown in stylistic noise.

THE RANKING IS WEAK EVIDENCE AND THE SET IS THE OUTPUT. Re-measured at 1,965 keys: 150
disagreed and the two genuine semantic defects ranked #22 and #30 of the 30 shown; the
hidden 120 were not measurably less suspicious, just less wordy. Set topN above the
disagreement count and READ THE LIST — topN costs display space, not engine time.
Do not add ranking cleverness on the strength of small-corpus numbers.

Findings come back in the SAME {key, code, detail} shape as every check, so the review
page renders them and escalation re-translates them with no new concepts anywhere.
"""

from __future__ import annotations

import math
import re

_STRIP = re.compile(r"[^\w\s]|_", re.UNICODE)


def _tokens(s: str) -> set[str]:
    """Word set, case- and punctuation-insensitive. Unicode-aware so accents survive."""
    return set(_STRIP.sub(" ", str(s).lower()).split())


def spread(a: str, b: str) -> float:
    """How far apart two renderings are: 0 = the same words, 1 = nothing in common.
    Token-set Jaccard rather than string equality, so word-order and punctuation
    differences still register while spacing does not."""
    x, y = _tokens(a), _tokens(b)
    inter = len(x & y)
    union = len(x) + len(y) - inter
    return 0.0 if union == 0 else 1 - inter / union


def _bands_of(keys: list[str], source_flat: dict, band_count: int) -> list[list[str]]:
    """Split keys into `band_count` length bands using the corpus's OWN sorted source
    lengths — no magic character constants, so a corpus of tooltips bands differently
    from a corpus of paragraphs."""
    ordered = sorted(keys, key=lambda k: len(str(source_flat[k])))
    size = math.ceil(len(ordered) / band_count) or 1
    return [ordered[i:i + size] for i in range(0, len(ordered), size)]


def _clip(s: str, n: int = 80) -> str:
    s = str(s)
    return s[:n] + "…" if len(s) > n else s


def rank_suspects(*, source_flat: dict, target_flat: dict, probe_flat: dict,
                  top_n: int = 20, band_count: int = 3) -> list[dict]:
    """Rank the keys whose two passes disagree and return the top `top_n` as findings.

    Length-normalised: raw spread correlates with source length (r~0.42 measured), so a
    flat ranking spends the whole budget on long paragraphs while the nastiest defects
    hide in short strings. Bands hand over their next-highest-spread key round-robin, so
    short strings get the same number of slots as long ones.

    A key whose two passes are IDENTICAL is never a suspect: that is the model telling
    us it is sure, and it is the majority of any catalogue."""
    scored = []
    for key in source_flat:
        a = target_flat.get(key)
        b = probe_flat.get(key)
        if not isinstance(a, str) or not isinstance(b, str):
            continue
        s = spread(a, b)
        if s == 0:
            continue
        scored.append({"key": key, "s": s, "alt": b})
    if not scored or top_n <= 0:
        return []

    by_key = {r["key"]: r for r in scored}
    bands = _bands_of([r["key"] for r in scored], source_flat, band_count)
    queues = [sorted((by_key[k] for k in band), key=lambda r: -r["s"]) for band in bands]

    picked: list[dict] = []
    i = 0
    while len(picked) < top_n:
        moved = False
        for q in queues:
            if i < len(q):
                picked.append(q[i])
                moved = True
                if len(picked) >= top_n:
                    break
        if not moved:
            break
        i += 1

    return [
        {
            "key": r["key"],
            "code": "disagreement",
            # The alternative rendering IS the useful part: a reviewer judges which is
            # right by seeing what the second pass said. A bare score sends them digging.
            "detail": f'a second pass wrote "{_clip(r["alt"])}" (spread {r["s"]:.2f})',
        }
        for r in sorted(picked, key=lambda r: -r["s"])
    ]
