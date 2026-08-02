# SPDX-License-Identifier: MIT
"""Terminology consistency — the check that reads the catalogue as its own glossary.

Ported from just-ai-help's `server/terms.js`. Every other check compares one string
against its source; none can see the defect where a translation is perfectly good on
its own and disagrees with the two thousand strings around it (measured:
`guardado automático` used where the catalogue says `autoguardado` fifteen times, and
nothing else in the pipeline could catch it).

NOT A DICTIONARY. This check knows nothing about Spanish or any language — language
rules written from memory are the thing conventions.json forbids about itself. It only
knows what THIS catalogue already does, which makes it correct in every language for
free, and wrong only in the direction of silence when a catalogue is too small to have
conventions yet.

THE THRESHOLDS ARE MEASURED, NOT PICKED TO FEEL SAFE (2,039-key catalogue,
2026-07-31): dominance 0.85 yields 30 advisory findings and still catches the defect
the check was built for; 0.90 goes quiet by ceasing to work; below 0.85 the extras are
polysemy. The 5-char stem is a MEASURED NECESSITY: without it, 102 findings, mostly
inflection (`personaje`/`personajes`). Over-merging is the safe direction — a merged
pair only ever removes a finding. All findings are ADVISORY, like `disagreement`.
"""

from __future__ import annotations

import re

DOMINANCE = 0.85

_PLACEHOLDER = re.compile(r"\{[^}]*\}")
_SPLIT = re.compile(r"[\W_]+", re.UNICODE)


def terms(text: str, min_len: int = 5) -> set[str]:
    """Content words only. Five characters is a blunt instrument for skipping function
    words without shipping a per-language stopword list — the lexical claim from memory
    this project bans."""
    bare = _PLACEHOLDER.sub(" ", str(text)).lower()
    return {w for w in _SPLIT.split(bare) if len(w) >= min_len}


def stem(w: str) -> str:
    """A crude stem: the first five characters. Deliberately dumb — a real stemmer is
    per-language."""
    return w[:5]


def _stems_of(text: str, min_len: int) -> set[str]:
    return {stem(w) for w in terms(text, min_len)}


def term_index(*, source_flat: dict, target_flat: dict, min_keys: int = 4,
               dominance: float = DOMINANCE, min_len: int = 5) -> dict:
    """The catalogue's own glossary: source term → the target term that habitually
    accompanies it, with the evidence. Counting is done on STEMS so inflections agree;
    the reported term is the commonest full form — a finding names a word a human
    recognises, not a five-letter fragment."""
    by_source: dict[str, list[str]] = {}
    for key, src in source_flat.items():
        if key not in target_flat:
            continue
        for t in terms(src, min_len):
            by_source.setdefault(t, []).append(key)

    index: dict[str, dict] = {}
    for src_term, keys in by_source.items():
        if len(keys) < min_keys:
            continue
        counts: dict[str, int] = {}
        forms: dict[str, dict[str, int]] = {}
        for key in keys:
            seen: set[str] = set()
            for full in terms(target_flat[key], min_len):
                s = stem(full)
                if s not in seen:
                    counts[s] = counts.get(s, 0) + 1
                    seen.add(s)
                forms.setdefault(s, {})
                forms[s][full] = forms[s].get(full, 0) + 1

        if not counts:
            continue
        best_stem, hits = max(counts.items(), key=lambda kv: kv[1])
        coverage = hits / len(keys)
        # Several fair renderings of a common word is the normal case, not a defect.
        if coverage < dominance or hits < min_keys:
            continue
        commonest = max(forms[best_stem].items(), key=lambda kv: kv[1])[0]
        index[src_term] = {"target": commonest, "stem": best_stem, "hits": hits,
                           "keys": len(keys), "coverage": coverage}
    return index


def check_key_terms(*, key: str, src: str, dst: str | None, index: dict,
                    min_len: int = 5) -> list[dict]:
    """Findings for one key against an already-built index — split from the sweep so
    the review panel can ask about the key on screen without rebuilding the index for
    two thousand keys on every keystroke."""
    if dst is None:
        return []
    dst_stems = _stems_of(dst, min_len)
    out = []
    for t in terms(src, min_len):
        conv = index.get(t)
        if conv is None or conv["stem"] in dst_stems:
            continue
        out.append({
            "key": key,
            "code": "terminology",
            "advisory": True,
            "detail": (f'"{t}" is rendered "{conv["target"]}" in {conv["hits"]} of '
                       f'{conv["keys"]} other keys ({round(conv["coverage"] * 100)}%); '
                       "this one does not use it"),
            "term": t,
            "expected": conv["target"],
        })
    return out


def check_terms(*, source_flat: dict, target_flat: dict, min_keys: int = 4,
                dominance: float = DOMINANCE) -> dict:
    """Sweeps the whole catalogue. Returns findings AND the index — the caller usually
    wants both, and building it twice on 2,039 keys is pure waste."""
    index = term_index(source_flat=source_flat, target_flat=target_flat,
                       min_keys=min_keys, dominance=dominance)
    findings = []
    for key, src in source_flat.items():
        if key not in target_flat:
            continue
        findings.extend(check_key_terms(key=key, src=src, dst=target_flat[key], index=index))
    return {"findings": findings, "index": index}


def term_usage(*, source_flat: dict, target_flat: dict, term: str) -> list[dict]:
    """How a term is actually rendered across the catalogue — the honest form of the
    feature: the check says "this disagrees with 15 other keys"; this says "here are
    those 15, go look" — and sometimes the fifteen are the ones that are wrong."""
    t = term.lower()
    counts: dict[str, int] = {}
    examples: dict[str, str] = {}
    for key, src in source_flat.items():
        if key not in target_flat or t not in terms(src):
            continue
        for tgt in terms(target_flat[key]):
            counts[tgt] = counts.get(tgt, 0) + 1
            examples.setdefault(tgt, key)
    return [{"target": tgt, "count": n, "example": examples[tgt]}
            for tgt, n in sorted(counts.items(), key=lambda kv: -kv[1])]
