# SPDX-License-Identifier: MIT
"""Placeholder shielding + the translation prompt — the pure heart of the loop.

Ported from just-ai-help's `server/loop.js`, minus the transport: `buildRequest`,
`callModel` and `effectiveTemperature` deliberately did NOT come along. The request body
belongs to llm-runner's dispatch/adapters now, and per-request temperature belongs to the
engine preset each feature points at — the probe's non-zero-temperature guard reads the
RESOLVED PRESET when the loop ports. What carries is everything the 2026-07 measurements
were about:

SHIELDING IS A SUBSTITUTION, NOT AN INSTRUCTION. Interpolations — and do-not-translate
terms — are swapped for ⟦0⟧-style tokens before the model sees them and restored by index
afterwards. Told in the system prompt by name never to translate "Strands", lingo.dev's
qwen3:8b run wrote "Hilos", and so did one run of the owned loop while another run of the
identical code got it right. A rule the model may or may not follow is not a guarantee; a
substitution is. And an index is checkable: a restored string that does not carry every
token exactly once is a FAILURE routed to retry, never a result.

The brackets are U+27E6/U+27E7 (MATHEMATICAL WHITE SQUARE BRACKET) — they occur in no UI
string and no natural language, so a false positive is not possible.
"""

from __future__ import annotations

import hashlib
import json
import re

# Tolerant of a model inserting spaces inside the brackets.
_SHIELD_RE = re.compile(r"⟦\s*(\d+)\s*⟧")

# Letters+digits boundary, matching the JS `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`.
# Python's `\w` includes the underscore, which JS's \p{L}\p{N} does not — `[^\W_]`
# is \w minus underscore, i.e. exactly unicode letters+digits.
_BOUNDED = "(?<![^\\W_]){term}(?![^\\W_])"


def term_present(term: str, text: str) -> bool:
    """The ONE definition of "this term occurs here" — shared by shield() and
    check_glossary so they can never disagree (audit 2026-08-05: the check used
    a bare substring while shield used this boundary, so a term inside a longer
    word was left alone by one and flagged — or silently passed — by the other)."""
    return re.search(_BOUNDED.format(term=re.escape(term)), text) is not None


def shield(text: str, placeholder_pattern: re.Pattern[str], terms: list[str] | None = None):
    """Replaces each interpolation — and each do-not-translate term — with an indexed
    shield token. Terms are matched longest-first so a term that contains another is
    shielded whole, and only at non-letter boundaries so a brand name inside a longer
    word is left alone. Returns (shielded_text, tokens)."""
    tokens: list[str] = []

    def take(m: re.Match[str]) -> str:
        tokens.append(m.group(0))
        return f"⟦{len(tokens) - 1}⟧"

    shielded = placeholder_pattern.sub(take, text)
    for term in sorted(terms or [], key=len, reverse=True):
        shielded = re.sub(_BOUNDED.format(term=re.escape(term)), take, shielded)
    return shielded, tokens


def restore(text: str, tokens: list[str]) -> str | None:
    """Restores shield tokens. Returns None when the model did not reproduce every token
    exactly once — a None here is what routes the item into the retry path."""
    seen: set[int] = set()
    bad = False

    def put(m: re.Match[str]) -> str:
        nonlocal bad
        i = int(m.group(1))
        if i >= len(tokens) or i in seen:
            bad = True
            return ""
        seen.add(i)
        return tokens[i]

    restored = _SHIELD_RE.sub(put, text)
    if bad or len(seen) != len(tokens):
        return None
    return restored


# ── the prompt ───────────────────────────────────────────────────────────────────────
# One template, slots filled from config. Every rule in it exists because something got
# it wrong on the corpus: placeholders (lingo.dev wrote {3}), the glossary (it wrote
# "Hilos" for "Strands"), the conventions line (qwen3 missed the opening ¿ 5/5), and
# plural pipes (an engine that splits the halves apart translates them inconsistently).


def build_system_prompt(
    *,
    source: str,
    target_lang: str,
    do_not_translate: list[str] | None = None,
    conventions_line: str = "",
    plural_separator: str | None = None,
) -> str:
    """The system half. The plural rule is BUILT FROM THE CONFIGURED SEPARATOR and omitted
    entirely when a catalogue has none — it used to be the literal `" | "`, which made
    pluralSeparator a half-honoured setting: the checks split on your value while the model
    was told about a pipe. i18next catalogues legitimately have no separator (plurals are
    separate keys), and telling the model one exists is a false instruction."""
    plural_rule = (
        f'a string containing "{plural_separator}" holds plural forms — '
        "translate each half and keep the separator"
        if plural_separator
        else ""
    )
    rules = [
        r
        for r in [
            "tokens like ⟦0⟧ are untouchable placeholders — reproduce each exactly once",
            f"never translate these terms: {', '.join(do_not_translate)}" if do_not_translate else "",
            conventions_line,
            plural_rule,
            'an item may carry a "note" — it describes how that string is used; follow it',
            "output ONLY JSON matching the schema",
        ]
        if r
    ]
    return (
        f"You are a professional software-UI translator, {source}→{target_lang}. "
        f"Rules: {'; '.join(rules)}."
    )


def build_user_message(shielded_items: list[dict], cfg: dict) -> str:
    """The user half: the catalogue's context line, then the items.

    PER-KEY NOTES live here. `cfg["context"]` is one sentence for the ENTIRE catalogue, so
    a four-character label and a two-hundred-character paragraph arrive with identical
    context — that is how `characterAudit.why` (EN "Why:", a label above a reasoning
    block) came back as "¿Por qué?", a question. A note is written by a reviewer for a key
    they are ALREADY fixing, so the fix compounds instead of recurring; only keys that
    have one carry the field, so batches do not grow for the 99% that need nothing."""
    notes = cfg.get("notes") or {}
    items = []
    for s in shielded_items:
        item: dict = {"id": s["i"], "text": s["shielded"]}
        note = notes.get(s.get("key"))
        if note:
            item["note"] = note
        items.append(item)
    context = cfg.get("context") or "a software application"
    return f"Context: {context}. Translate items: {json.dumps(items, ensure_ascii=False)}"


# The response contract. Ids come back so a reordered or partial answer is detectable
# rather than silently misaligned. Handed to the engine preset / dispatch layer as the
# structured-output schema when the loop ports.
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "translation": {"type": "string"},
                },
                "required": ["id", "translation"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["items"],
    "additionalProperties": False,
}


def parse_items(content: str) -> dict[int, str]:
    """Parses the model's JSON into {id: translation}. Some servers wrap JSON in a fence
    even under a schema — one salvage attempt, then fail loudly."""
    try:
        parsed = json.loads(content)
    except ValueError:
        m = re.search(r"\{[\s\S]*\}", content)
        if not m:
            raise ValueError(f"Response was not JSON: {content[:200]}") from None
        parsed = json.loads(m.group(0))
    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        # ValueError on purpose (TRY004 wants TypeError): the caller passed a fine str —
        # it is the MODEL's reply that is invalid, and the retry ladder catches ValueError.
        raise ValueError("Response JSON had no `items` array.")  # noqa: TRY004
    out: dict[int, str] = {}
    for it in items:
        if isinstance(it, dict) and isinstance(it.get("id"), int) and isinstance(it.get("translation"), str):
            out[it["id"]] = it["translation"]
    return out


# ── cache key ────────────────────────────────────────────────────────────────────────
# The delta. A key is skipped when its target already exists AND the hash of everything
# that could change its translation is unchanged: the source text, the language, the
# context sentence and the glossary. Change the context and every key re-translates —
# correct, because the context is part of the instruction the translation came from.


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def cache_key(*, text: str, lang: str, context_hash: str, glossary_hash: str) -> str:
    return sha1(f"{text}|{lang}|{context_hash}|{glossary_hash}")
