// SPDX-License-Identifier: MIT
// Layer 2 — the checks. THE differentiator. The port of checks.py (ported from just-ai-help's
// `server/checks.js`, whose spec is the Translate Toolkit's `pofilter` test LIST — a
// decades-old distillation of what actually goes wrong in translation; nothing else does
// content QA on a translated locale file). Every check is a pure function of (source, target,
// ctx) returning zero or more findings, and every finding has one shape:
//
//     {key, code, detail}
//
// One shape everywhere, because this list is not just a pre-ship gate — it is the feed the
// review page triages on. A check that cannot say WHICH key and WHY is not usable there.
//
// The bar for a check being here at all: it must BITE. Each one has a test that hands it a
// deliberately broken string and asserts it complains, because a check that has never been
// seen to fail is indistinguishable from a check that cannot fail.
//
// (The NUL war story, short: the JS original carried a literal NUL byte in `multiset` for
// months — git called the file BINARY and grep skipped it — and the Python port's first write
// did it again. The separator stays NUL — a space would let ["a b","c"] alias ["a","b c"] —
// written as the four-character ESCAPE, never the byte. History: checks.py.)
//
// Python's text semantics throughout: `\d`/`\s`/`\w` are Unicode, strip() is Python's
// whitespace, `s[-1:]` is the last CODE POINT (jsonio.js).

import { cpSlice, D, lstrip, pyGet, pySorted, rstrip, S, strip, truthy } from "@delebash/llm-runner/platform/py";
import { ALNUM, asMap, findAll, LETTER, placeholderRe, pyCount } from "./jsonio.js";
import { termPresent } from "./shieldlib.js";

const multiset = (items) => pySorted(items).join("\x00");

// ── the individual checks ────────────────────────────────────────────────────
// Each takes (src, dst, ctx) and returns a list of {code, detail}. `ctx` carries the
// config-derived bits: the placeholder regex, the glossary, the plural separator and the
// target language's conventions row.

/** Placeholders: the same interpolations, the same number of times. */
export function checkPlaceholders(src, dst, ctx) {
  const a = findAll(ctx.placeholder_re, src);
  const b = findAll(ctx.placeholder_re, dst);
  if (multiset(a) === multiset(b)) return [];
  return [
    {
      code: "placeholder-changed",
      detail: `source has ${a.join(" ") || "none"}, target has ${b.join(" ") || "none"}`,
    },
  ];
}

/**
 * Plural forms. Two failures, and the second is the one nothing else catches: halves that
 * came back IDENTICAL pass every structural test — right separator, right placeholders,
 * right word count — and are still wrong, because the whole point of the form is that the
 * singular and the plural differ.
 */
export function checkPlural(src, dst, ctx) {
  const sep = ctx.plural_separator;
  if (!truthy(sep) || !src.includes(sep)) return [];
  const s = src.split(sep);
  const d = dst.split(sep);
  if (s.length !== d.length) {
    return [{ code: "plural-halves-lost", detail: `source has ${s.length} forms, target has ${d.length}` }];
  }
  const halves = d.map((h) => strip(h));
  if (new Set(halves).size !== halves.length) {
    return [{ code: "plural-halves-identical", detail: `both forms are "${halves[0]}"` }];
  }
  return [];
}

/**
 * Do-not-translate terms survived. Occurrence = shieldlib's boundary rule, THE one
 * definition (audit 2026-08-05: this check used a bare substring while shield() used the
 * boundary — "Act" inside "Actor" raised a false finding, and inside dst "Action" silently
 * passed a translation that lost the term).
 */
export function checkGlossary(src, dst, ctx) {
  const out = [];
  for (const term of ctx.do_not_translate || []) {
    if (termPresent(term, src) && !termPresent(term, dst)) {
      out.push({ code: "glossary-translated", detail: `"${term}" is missing from the translation` });
    }
  }
  return out;
}

const HAS_LETTER = new RegExp(LETTER, "u");

/**
 * Identical to the source. Usually means the model skipped the item.
 *
 * Exempt: a string with nothing translatable in it — only placeholders, glossary terms,
 * digits and punctuation. "Strands" comes back as "Strands" BY DESIGN (it is shielded), and a
 * check that flags its own correct behaviour trains people to ignore the report. (Measured
 * rate on a real catalogue: 8-in-9 of this check's findings were correct output — cognates,
 * names, glyphs. That is why `accepted.json` exists downstream.)
 */
export function checkUntranslated(src, dst, ctx) {
  if (src !== dst) return [];
  let bare = src.replace(ctx.placeholder_re, " ");
  for (const term of ctx.do_not_translate || []) bare = bare.replaceAll(term, " ");
  if (!HAS_LETTER.test(bare)) return [];
  return [{ code: "untranslated", detail: "identical to the source string" }];
}

/**
 * Paired punctuation the TARGET requires regardless of what the source did — Spanish's ¿ and
 * ¡. English has no opening mark, so a translator that mirrors the source is wrong and
 * nothing structural notices. Measured 2026-07-27: qwen3:8b got this wrong on 5 of 5
 * questions, with the rule in the system prompt.
 */
export function checkStartPunc(src, dst, ctx) {
  const out = [];
  for (const [opener, closer] of ctx.paired_punct || []) {
    const opens = pyCount(dst, opener);
    const closes = pyCount(dst, closer);
    if (closes > opens) {
      out.push({ code: "startpunc", detail: `${closes} "${closer}" but only ${opens} opening "${opener}"` });
    }
  }
  return out;
}

/**
 * The inverse of checkStartPunc, and it exists because the cure caused the disease. Told "a
 * question opens with ¿", gemma3:12b applied it to things that were not questions: measured
 * on the full 846-key catalogue, 72 ¿ against 16 real questions — "Try tutorial project"
 * came back "¿Probar proyecto de tutorial?". So: if the target opens a paired mark the
 * SOURCE never closed, the model invented a question. On the 1,965-key run this check went
 * 10 findings / 10 real errors — a 100% hit rate, including two semantic INVERSIONS nothing
 * else caught.
 */
export function checkSpuriousPunc(src, dst, ctx) {
  const out = [];
  for (const [opener, closer] of ctx.paired_punct || []) {
    if (!dst.includes(opener)) continue;
    if (src.includes(closer)) continue; // the source really is a question/exclamation
    const kind = closer === "?" ? "question" : "exclamation";
    out.push({ code: "spurious-interrogative", detail: `target opens "${opener}" but the source is not a ${kind}` });
  }
  return out;
}

const TERMINAL = ".?!:;…";

/** Terminal punctuation matches the source's. A dropped full stop is a real defect. */
export function checkEndPunc(src, dst, _ctx) {
  const s = rstrip(src) ? cpSlice(rstrip(src), -1) : "";
  const d = rstrip(dst) ? cpSlice(rstrip(dst), -1) : "";
  // `"" in TERMINAL` is True in Python — and String.includes("") is true too.
  if (!TERMINAL.includes(s) && !TERMINAL.includes(d)) return [];
  if (s === d) return [];
  return [{ code: "endpunc", detail: `source ends "${s}", target ends "${d}"` }];
}

const NUMBER_RE = new RegExp(`${D}+`, "gu");

/** Every number in the source appears in the target. A translated quantity is a data bug. */
export function checkNumbers(src, dst, _ctx) {
  const a = findAll(NUMBER_RE, src);
  const b = findAll(NUMBER_RE, dst);
  if (multiset(a) === multiset(b)) return [];
  return [{ code: "numbers", detail: `source has ${a.join(" ") || "none"}, target has ${b.join(" ") || "none"}` }];
}

const BRACKETS = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
];

/**
 * Bracket counts match the source's, per pair. Catches a dropped or duplicated wrapper. (A
 * parenthetical GLOSS is a reviewer's call, not a defect — measured: "Headless access" →
 * "Acceso sin interfaz (headless)" is arguably good practice — which is exactly why this
 * reports rather than rejects.)
 */
export function checkBrackets(src, dst, _ctx) {
  const out = [];
  for (const [open, close] of BRACKETS) {
    const so = pyCount(src, open);
    const sc = pyCount(src, close);
    const to = pyCount(dst, open);
    const tc = pyCount(dst, close);
    if (so !== to || sc !== tc) {
      out.push({ code: "brackets", detail: `source ${so}${open}/${sc}${close}, target ${to}${open}/${tc}${close}` });
    }
  }
  return out;
}

/** Blank: the source says something, the target is whitespace. */
export function checkBlank(src, dst, _ctx) {
  if (strip(src) && !strip(dst)) return [{ code: "blank", detail: "target is empty or whitespace" }];
  return [];
}

// Letters-only word, repeated back to back, at letter boundaries — "de de". The backreference
// under IGNORECASE catches "El el" too, exactly like the JS `iu` flags.
const DOUBLE_RE = new RegExp(`(?<!${ALNUM})(${LETTER}{2,})(${S}+)\\1(?!${ALNUM})`, "iu");

/** A word repeated back to back — "de de". A classic generation stutter. */
export function checkDoubleWords(_src, dst, _ctx) {
  const m = DOUBLE_RE.exec(dst);
  if (!m) return [];
  return [{ code: "doublewords", detail: `"${m[1]}" appears twice in a row` }];
}

/** Leading and trailing whitespace parity — a UI string is often concatenated. */
export function checkWhitespace(src, dst, _ctx) {
  const lead = (s) => s.slice(0, s.length - lstrip(s).length);
  const trail = (s) => s.slice(rstrip(s).length);
  if (lead(src) !== lead(dst)) return [{ code: "whitespace", detail: "leading whitespace differs from the source" }];
  if (trail(src) !== trail(dst)) return [{ code: "whitespace", detail: "trailing whitespace differs from the source" }];
  return [];
}

// Every per-string check, in report order.
export const STRING_CHECKS = [
  checkBlank,
  checkPlaceholders,
  checkPlural,
  checkGlossary,
  checkUntranslated,
  checkStartPunc,
  checkSpuriousPunc,
  checkEndPunc,
  checkNumbers,
  checkBrackets,
  checkDoubleWords,
  checkWhitespace,
];

/**
 * Builds the context every check reads, from a project config + the conventions table. A
 * language with no conventions row gets NO paired-punctuation rules — shipping rules we do
 * not know is worse than shipping none. (The keys keep Python's names: they are the check
 * functions' contract.)
 */
export function buildContext(cfg, conventions, lang) {
  const glossary = pyGet(cfg, "glossary");
  const conv = pyGet(conventions, lang);
  return {
    placeholder_re: placeholderRe(cfg.placeholder),
    plural_separator: pyGet(cfg, "pluralSeparator"),
    do_not_translate: pyGet(truthy(glossary) ? glossary : {}, "doNotTranslate", []),
    paired_punct: pyGet(truthy(conv) ? conv : {}, "pairedPunct", []),
  };
}

/** Runs every check over a whole locale pair. Returns the triage feed. */
export function runChecks({ sourceFlat, targetFlat, ctx }) {
  const target = asMap(targetFlat);
  const findings = [];
  for (const [key, src] of asMap(sourceFlat)) {
    const dst = target.has(key) ? target.get(key) : null;
    if (dst === null || dst === undefined) {
      findings.push({ key, code: "missing", detail: "no translation was written" });
      continue;
    }
    for (const check of STRING_CHECKS) for (const f of check(src, dst, ctx)) findings.push({ key, ...f });
  }
  return findings;
}

/** The checks for ONE key — what the review page calls after a save. */
export function checkOne({ key, src, dst, ctx }) {
  if (dst === null || dst === undefined) return [{ key, code: "missing", detail: "no translation was written" }];
  const out = [];
  for (const check of STRING_CHECKS) for (const f of check(src, dst, ctx)) out.push({ key, ...f });
  return out;
}

/** Groups findings by code for a human-readable console report (a Map, first-seen order). */
export function summarise(findings) {
  const byCode = new Map();
  for (const f of findings) {
    if (!byCode.has(f.code)) byCode.set(f.code, []);
    byCode.get(f.code).push(f);
  }
  return byCode;
}
