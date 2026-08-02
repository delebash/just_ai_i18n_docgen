# SPDX-License-Identifier: MIT
"""Locale-file walking — shared because two copies drift.

Ported from just-ai-help's `server/jsonutil.js`. The translate loop, the checks and the
review surface all walk a locale file the same way: if they disagree about what a key path
is or what counts as a placeholder, the checks stop describing what the loop wrote and the
review page stops addressing the keys the checks named.
"""

from __future__ import annotations

import re


def flatten(obj: dict, prefix: str = "", out: dict[str, str] | None = None) -> dict[str, str]:
    """Flattens a nested locale object into {"a.b.c": "text"}. Non-dict leaves are
    stringified (locale files hold strings; anything else is someone's bug surfaced,
    not hidden)."""
    if out is None:
        out = {}
    for k, v in obj.items():
        path = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            flatten(v, path, out)
        else:
            out[path] = str(v)
    return out


def rebuild(source: dict, values: dict[str, str], prefix: str = "") -> dict:
    """Rebuilds a nested object with the SOURCE's shape and key order, each leaf taken
    from `values` (a flat map). Leaves missing from `values` are DROPPED, so a key that
    failed to translate is absent rather than silently English — the checks then report
    it as `missing`, which is the point of never faking success."""
    out: dict = {}
    for k, v in source.items():
        path = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            child = rebuild(v, values, path)
            if child:
                out[k] = child
        elif path in values:
            out[k] = values[path]
    return out


def placeholder_re(placeholder: dict) -> re.Pattern[str]:
    """The interpolation matcher, built from the config's placeholder syntax
    ({"prefix": "{", "suffix": "}"} and friends). Non-greedy across newlines, exactly
    like the JS original's `[\\s\\S]*?`."""
    return re.compile(
        re.escape(placeholder["prefix"]) + r".*?" + re.escape(placeholder["suffix"]),
        re.DOTALL,
    )
