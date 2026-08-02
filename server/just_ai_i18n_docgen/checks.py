# SPDX-License-Identifier: MIT
"""Layer 2 — the checks. THE differentiator.

Ported from just-ai-help's `server/checks.js`, whose spec is the Translate Toolkit's
`pofilter` test LIST (a decades-old distillation of what actually goes wrong in
translation — surveyed 2026-07-27; nothing else does content QA on a translated locale
file). Every check is a pure function of (source, target, ctx) returning zero or more
findings, and every finding has one shape:

    {"key": …, "code": …, "detail": …}

One shape everywhere, because this list is not just a pre-ship gate — it is the feed the
review page triages on. A check that cannot say WHICH key and WHY is not usable there.

The bar for a check being here at all: it must BITE. Each one has a test that hands it a
deliberately broken string and asserts it complains, because a check that has never been
seen to fail is indistinguishable from a check that cannot fail.

(The JS original carried a literal NUL byte in `multiset` for months, which made git call
the project's most important file BINARY and made grep skip it silently. THIS PORT THEN
DID IT AGAIN on day one — the first write of this file shipped a literal NUL in the same
function, and Python refused to compile it: "source code string cannot contain null
bytes". The separator stays NUL — a space would let ["a b","c"] alias ["a","b c"] — but
as the four-character ESCAPE. Python's compiler is the tripwire JS never had: a literal
NUL cannot come back silently here, the file simply stops importing.)
"""

from __future__ import annotations

import re

Finding = dict  # {"key": str, "code": str, "detail": str} — kept dict-shaped: it IS the JSON feed


def _multiset(items: list[str]) -> str:
    return "\x00".join(sorted(items))


# ── the individual checks ────────────────────────────────────────────────────────────
# Each takes (src, dst, ctx) and returns a list of {code, detail}. `ctx` carries the
# config-derived bits: the placeholder regex, the glossary, the plural separator and the
# target language's conventions row.


def check_placeholders(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Placeholders: the same interpolations, the same number of times."""
    a = ctx["placeholder_re"].findall(src)
    b = ctx["placeholder_re"].findall(dst)
    if _multiset(a) == _multiset(b):
        return []
    return [{
        "code": "placeholder-changed",
        "detail": f"source has {' '.join(a) or 'none'}, target has {' '.join(b) or 'none'}",
    }]


def check_plural(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Plural forms. Two failures, and the second is the one nothing else catches: halves
    that came back IDENTICAL pass every structural test — right separator, right
    placeholders, right word count — and are still wrong, because the whole point of the
    form is that the singular and the plural differ."""
    sep = ctx.get("plural_separator")
    if not sep or sep not in src:
        return []
    s = src.split(sep)
    d = dst.split(sep)
    if len(s) != len(d):
        return [{
            "code": "plural-halves-lost",
            "detail": f"source has {len(s)} forms, target has {len(d)}",
        }]
    halves = [h.strip() for h in d]
    if len(set(halves)) != len(halves):
        return [{"code": "plural-halves-identical", "detail": f'both forms are "{halves[0]}"'}]
    return []


def check_glossary(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Do-not-translate terms survived."""
    out = []
    for term in ctx.get("do_not_translate") or []:
        if term in src and term not in dst:
            out.append({
                "code": "glossary-translated",
                "detail": f'"{term}" is missing from the translation',
            })
    return out


def check_untranslated(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Identical to the source. Usually means the model skipped the item.

    Exempt: a string with nothing translatable in it — only placeholders, glossary terms,
    digits and punctuation. "Strands" comes back as "Strands" BY DESIGN (it is shielded),
    and a check that flags its own correct behaviour trains people to ignore the report.
    (Measured rate on a real catalogue: 8-in-9 of this check's findings were correct
    output — cognates, names, glyphs. That is why `accepted.json` exists downstream.)"""
    if src != dst:
        return []
    bare = ctx["placeholder_re"].sub(" ", src)
    for term in ctx.get("do_not_translate") or []:
        bare = bare.replace(term, " ")
    if not re.search(r"[^\W\d_]", bare):
        return []
    return [{"code": "untranslated", "detail": "identical to the source string"}]


def check_start_punc(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Paired punctuation the TARGET requires regardless of what the source did —
    Spanish's ¿ and ¡. English has no opening mark, so a translator that mirrors the
    source is wrong and nothing structural notices. Measured 2026-07-27: qwen3:8b got
    this wrong on 5 of 5 questions, with the rule in the system prompt."""
    out = []
    for opener, closer in ctx.get("paired_punct") or []:
        opens = dst.count(opener)
        closes = dst.count(closer)
        if closes > opens:
            out.append({
                "code": "startpunc",
                "detail": f'{closes} "{closer}" but only {opens} opening "{opener}"',
            })
    return out


def check_spurious_punc(src: str, dst: str, ctx: dict) -> list[Finding]:
    """The inverse of check_start_punc, and it exists because the cure caused the disease.
    Told "a question opens with ¿", gemma3:12b applied it to things that were not
    questions: measured on the full 846-key catalogue, 72 ¿ against 16 real questions —
    "Try tutorial project" came back "¿Probar proyecto de tutorial?". So: if the target
    opens a paired mark the SOURCE never closed, the model invented a question. On the
    1,965-key run this check went 10 findings / 10 real errors — a 100% hit rate,
    including two semantic INVERSIONS nothing else caught."""
    out = []
    for opener, closer in ctx.get("paired_punct") or []:
        if opener not in dst:
            continue
        if closer in src:
            continue  # the source really is a question/exclamation
        kind = "question" if closer == "?" else "exclamation"
        out.append({
            "code": "spurious-interrogative",
            "detail": f'target opens "{opener}" but the source is not a {kind}',
        })
    return out


_TERMINAL = ".?!:;…"


def check_end_punc(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Terminal punctuation matches the source's. A dropped full stop is a real defect."""
    s = src.rstrip()[-1:] if src.rstrip() else ""
    d = dst.rstrip()[-1:] if dst.rstrip() else ""
    if s not in _TERMINAL and d not in _TERMINAL:
        return []
    if s == d:
        return []
    return [{"code": "endpunc", "detail": f'source ends "{s}", target ends "{d}"'}]


def check_numbers(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Every number in the source appears in the target. A translated quantity is a data bug."""
    a = re.findall(r"\d+", src)
    b = re.findall(r"\d+", dst)
    if _multiset(a) == _multiset(b):
        return []
    return [{
        "code": "numbers",
        "detail": f"source has {' '.join(a) or 'none'}, target has {' '.join(b) or 'none'}",
    }]


_BRACKETS = [("(", ")"), ("[", "]"), ("{", "}")]


def check_brackets(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Bracket counts match the source's, per pair. Catches a dropped or duplicated
    wrapper. (A parenthetical GLOSS is a reviewer's call, not a defect — measured:
    "Headless access" → "Acceso sin interfaz (headless)" is arguably good practice —
    which is exactly why this reports rather than rejects.)"""
    out = []
    for open_, close in _BRACKETS:
        so, sc = src.count(open_), src.count(close)
        to, tc = dst.count(open_), dst.count(close)
        if so != to or sc != tc:
            out.append({
                "code": "brackets",
                "detail": f"source {so}{open_}/{sc}{close}, target {to}{open_}/{tc}{close}",
            })
    return out


def check_blank(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Blank: the source says something, the target is whitespace."""
    if src.strip() and not dst.strip():
        return [{"code": "blank", "detail": "target is empty or whitespace"}]
    return []


# Letters-only word, repeated back to back, at letter boundaries — "de de". The
# backreference under IGNORECASE catches "El el" too, exactly like the JS `iu` flags.
_DOUBLE_RE = re.compile(r"(?<![^\W_])([^\W\d_]{2,})(\s+)\1(?![^\W_])", re.IGNORECASE)


def check_double_words(src: str, dst: str, ctx: dict) -> list[Finding]:
    """A word repeated back to back — "de de". A classic generation stutter."""
    m = _DOUBLE_RE.search(dst)
    if not m:
        return []
    return [{"code": "doublewords", "detail": f'"{m.group(1)}" appears twice in a row'}]


def check_whitespace(src: str, dst: str, ctx: dict) -> list[Finding]:
    """Leading and trailing whitespace parity — a UI string is often concatenated."""
    lead = lambda s: s[: len(s) - len(s.lstrip())]
    trail = lambda s: s[len(s.rstrip()):]
    if lead(src) != lead(dst):
        return [{"code": "whitespace", "detail": "leading whitespace differs from the source"}]
    if trail(src) != trail(dst):
        return [{"code": "whitespace", "detail": "trailing whitespace differs from the source"}]
    return []


# Every per-string check, in report order.
STRING_CHECKS = [
    check_blank,
    check_placeholders,
    check_plural,
    check_glossary,
    check_untranslated,
    check_start_punc,
    check_spurious_punc,
    check_end_punc,
    check_numbers,
    check_brackets,
    check_double_words,
    check_whitespace,
]


def build_context(cfg: dict, conventions: dict, lang: str) -> dict:
    """Builds the context every check reads, from a project config + the conventions table.
    A language with no conventions row gets NO paired-punctuation rules — shipping rules
    we do not know is worse than shipping none."""
    from .jsonio import placeholder_re

    return {
        "placeholder_re": placeholder_re(cfg["placeholder"]),
        "plural_separator": cfg.get("pluralSeparator"),
        "do_not_translate": (cfg.get("glossary") or {}).get("doNotTranslate", []),
        "paired_punct": (conventions.get(lang) or {}).get("pairedPunct", []),
    }


def run_checks(*, source_flat: dict[str, str], target_flat: dict[str, str], ctx: dict) -> list[Finding]:
    """Runs every check over a whole locale pair. Returns the triage feed."""
    findings: list[Finding] = []
    for key, src in source_flat.items():
        dst = target_flat.get(key)
        if dst is None:
            findings.append({"key": key, "code": "missing", "detail": "no translation was written"})
            continue
        for check in STRING_CHECKS:
            for f in check(src, dst, ctx):
                findings.append({"key": key, **f})
    return findings


def check_one(*, key: str, src: str, dst: str | None, ctx: dict) -> list[Finding]:
    """The checks for ONE key — what the review page calls after a save."""
    if dst is None:
        return [{"key": key, "code": "missing", "detail": "no translation was written"}]
    out: list[Finding] = []
    for check in STRING_CHECKS:
        for f in check(src, dst, ctx):
            out.append({"key": key, **f})
    return out


def summarise(findings: list[Finding]) -> dict[str, list[Finding]]:
    """Groups findings by code for a human-readable console report."""
    by_code: dict[str, list[Finding]] = {}
    for f in findings:
        by_code.setdefault(f["code"], []).append(f)
    return by_code
