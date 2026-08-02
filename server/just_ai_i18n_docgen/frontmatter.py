# SPDX-License-Identifier: MIT
"""Front-matter parsing for the docs extractor — a deliberately SMALL subset of YAML.

Ported from just-ai-help's `server/frontmatter.js`, hand-rolled on purpose (the Node
tool had zero dependencies; here the reason is sharper: PyYAML would ACCEPT the exact
constructs this parser must refuse). The danger with any front-matter parser is not
that it fails — it is that it SUCCEEDS on something it does not understand and silently
drops text, and the text it would drop here is user-facing copy that then never reaches
a locale file, never gets translated, and ships as a blank hint.

So the rule is: support a narrow, documented subset, and RAISE on anything else. A loud
failure at build time is cheap; a hint that quietly went missing is not.

Supported:

    ---
    lede: One sentence describing the surface.
    hints:
      fieldName: What this field is for.
      other: "Quoted when it contains: a colon."
    ---
    # The document body, untouched.

Not supported, and each raises: tabs for indentation, YAML lists, multi-line scalars
(| and >), nesting deeper than one level, duplicate keys.
"""

from __future__ import annotations

import re

_FENCE = re.compile(r"^---[ \t]*\r?\n")
_CLOSE = re.compile(r"^---[ \t]*$", re.MULTILINE)
_LIST_ITEM = re.compile(r"^\s*-\s")
_BLOCK_SCALAR = re.compile(r"^[|>][-+]?\d*$")


def _unquote(v: str) -> str:
    s = v.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def _fail(line: str, n: int, why: str) -> None:
    raise ValueError(f"front-matter line {n}: {why}\n  {line}")


def parse_front_matter(text: str) -> tuple[dict, str]:
    """Splits `text` into (data, body). A file with no front-matter fence returns
    ({}, text) — not an error; most docs will not have one yet."""
    if not _FENCE.match(text):
        return {}, text

    after_open = _FENCE.sub("", text, count=1)
    close = _CLOSE.search(after_open)
    if close is None:
        raise ValueError("front-matter: opening --- has no closing ---")

    block = after_open[:close.start()]
    body = re.sub(r"^---[ \t]*\r?\n?", "", after_open[close.start():])

    data: dict = {}
    parent: str | None = None

    for i, raw in enumerate(block.split("\n")):
        raw = raw.rstrip("\r")
        n = i + 2  # +1 for the opening fence, +1 for 1-based
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        if "\t" in raw:
            _fail(raw, n, "tabs are not allowed — use spaces")
        if _LIST_ITEM.match(raw):
            _fail(raw, n, "lists are not supported")

        indent = len(raw) - len(raw.lstrip())
        colon = raw.find(":")
        if colon == -1:
            _fail(raw, n, "expected `key: value`")

        key = raw[:colon].strip()
        value = raw[colon + 1:]
        if not key:
            _fail(raw, n, "empty key")
        # The block-scalar indicator is the VALUE, not the line's first character —
        # `lede: |` opens a multi-line string. Testing the line start missed it and the
        # parser then blamed an orphan indent one line later, naming the wrong problem.
        if _BLOCK_SCALAR.fullmatch(value.strip()):
            _fail(raw, n, "multi-line scalars (| and >) are not supported")

        if indent == 0:
            if key in data:
                _fail(raw, n, f'duplicate key "{key}"')
            if value.strip() == "":
                data[key] = {}
                parent = key
            else:
                data[key] = _unquote(value)
                parent = None
            continue

        # Indented: must belong to a map opened on a previous line.
        if parent is None:
            _fail(raw, n, "indented line with no parent key above it")
        if value.strip() == "":
            _fail(raw, n, "nesting deeper than one level is not supported")
        if key in data[parent]:
            _fail(raw, n, f'duplicate key "{parent}.{key}"')
        data[parent][key] = _unquote(value)

    return data, body
