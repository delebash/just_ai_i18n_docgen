# SPDX-License-Identifier: MIT
"""Reading the source catalogue to work out what the config used to have to state.

Ported from just-ai-help's `server/infer.js`. `placeholder` and `pluralSeparator` were
required config, and both were traps: omit `placeholder` and the tool threw a raw
TypeError naming no field; `pluralSeparator` was honoured by the CHECKS and ignored by
the PROMPT, which had `" | "` typed into it — keep the default and it worked by
coincidence; set ";" and the model was told the wrong separator, then the checker blamed
the model for obeying the tool. Both facts sit in en.json; reading them removes two
fields nobody can get right by hand.

PRECEDENCE: an explicit config value always wins. Inference is a default, never an
override — a catalogue mid-migration might contain both `{n}` and `{{n}}`, and the human
knows which one is being moved to. Whatever was inferred is REPORTED, never decided
quietly — the whole complaint about this tool was invisible decisions.
"""

from __future__ import annotations

import json
import re

# The interpolation syntaxes worth detecting, longest delimiter first so `{{` beats `{`.
_SYNTAXES = [
    {"prefix": "{{", "suffix": "}}", "re": re.compile(r"\{\{[^{}]+\}\}")},  # i18next
    {"prefix": "{", "suffix": "}", "re": re.compile(r"\{[^{}]+\}")},        # vue-i18n, ICU
    {"prefix": "%{", "suffix": "}", "re": re.compile(r"%\{[^{}]+\}")},      # ruby-i18n / polyglot
]


def infer_placeholder(values: list[str]) -> dict:
    """Which interpolation syntax this catalogue uses. Counts real matches rather than
    stopping at the first hit: a vue-i18n catalogue containing one literal `{{` in prose
    must not be read as i18next. `{{a}}` also matches the single-brace pattern, so
    i18next wins ties by being tested first and requiring a strictly greater count to be
    displaced."""
    text = "\n".join(values)
    best = None
    for s in _SYNTAXES:
        n = len(s["re"].findall(text))
        if n > 0 and (best is None or n > best["n"]):
            best = {"prefix": s["prefix"], "suffix": s["suffix"], "n": n}
    if best is None:
        return {"prefix": "{", "suffix": "}"}
    return {"prefix": best["prefix"], "suffix": best["suffix"]}


# Separators worth detecting, in the order a framework is likely to use them.
_SEPARATORS = [" | ", "|", " || ", "||"]


def infer_plural_separator(values: list[str]) -> str | None:
    """The plural separator this catalogue uses, or None when it has no plural forms.

    None is a real answer, not a failure: i18next stores plurals as separate keys, so a
    catalogue can legitimately have none — and the checks correctly skip plural checking
    when the separator is None. A separator has to split a string into parts that all
    have content, or it is just a pipe character inside prose."""
    for sep in _SEPARATORS:
        for v in values:
            if sep in v and all(half.strip() for half in v.split(sep)):
                return sep
    return None


def infer_config(cfg: dict, source_flat: dict[str, str]) -> tuple[dict, list[str]]:
    """Fills in what the config did not state, from the source strings themselves.
    Returns (config, inferred_descriptions) so a run can SAY what it guessed."""
    values = [v for v in source_flat.values() if isinstance(v, str)]
    out = dict(cfg)
    inferred: list[str] = []

    if not out.get("placeholder"):
        out["placeholder"] = infer_placeholder(values)
        inferred.append(
            f"placeholder {out['placeholder']['prefix']}…{out['placeholder']['suffix']}"
        )
    if "pluralSeparator" not in out:
        out["pluralSeparator"] = infer_plural_separator(values)
        sep = out["pluralSeparator"]
        inferred.append(f"pluralSeparator {'none' if sep is None else json.dumps(sep)}")
    # `glossary` accepts a bare array as well as {"doNotTranslate": [...]} — the nesting
    # bought nothing and the array is what every config actually wants to write.
    if isinstance(out.get("glossary"), list):
        out["glossary"] = {"doNotTranslate": out["glossary"]}

    return out, inferred
