// SPDX-License-Identifier: MIT
// Reading the source catalogue to work out what the config used to have to state. The port of
// infer.py (ported from just-ai-help's `server/infer.js`).
//
// `placeholder` and `pluralSeparator` were required config, and both were traps: omit
// `placeholder` and the tool threw a raw TypeError naming no field; `pluralSeparator` was
// honoured by the CHECKS and ignored by the PROMPT, which had `" | "` typed into it. Both
// facts sit in en.json; reading them removes two fields nobody can get right by hand.
//
// PRECEDENCE: an explicit config value always wins. Inference is a default, never an
// override — a catalogue mid-migration might contain both `{n}` and `{{n}}`, and the human
// knows which one is being moved to. Whatever was inferred is REPORTED, never decided
// quietly — the whole complaint about this tool was invisible decisions.

import { dhas } from "./jsonio.js";
import { strip, truthy } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";

// The interpolation syntaxes worth detecting, longest delimiter first so `{{` beats `{`.
const SYNTAXES = [
  { prefix: "{{", suffix: "}}", re: /\{\{[^{}]+\}\}/gu }, // i18next
  { prefix: "{", suffix: "}", re: /\{[^{}]+\}/gu }, // vue-i18n, ICU
  { prefix: "%{", suffix: "}", re: /%\{[^{}]+\}/gu }, // ruby-i18n / polyglot
];

/**
 * Which interpolation syntax this catalogue uses. Counts real matches rather than stopping
 * at the first hit: a vue-i18n catalogue containing one literal `{{` in prose must not be
 * read as i18next. `{{a}}` also matches the single-brace pattern, so i18next wins ties by
 * being tested first and requiring a strictly greater count to be displaced.
 */
export function inferPlaceholder(values) {
  const text = values.join("\n");
  let best = null;
  for (const s of SYNTAXES) {
    const n = [...text.matchAll(s.re)].length;
    if (n > 0 && (best === null || n > best.n)) best = { prefix: s.prefix, suffix: s.suffix, n };
  }
  if (best === null) return { prefix: "{", suffix: "}" };
  return { prefix: best.prefix, suffix: best.suffix };
}

// Separators worth detecting, in the order a framework is likely to use them.
const SEPARATORS = [" | ", "|", " || ", "||"];

/**
 * The plural separator this catalogue uses, or null when it has no plural forms.
 *
 * null is a real answer, not a failure: i18next stores plurals as separate keys, so a
 * catalogue can legitimately have none — and the checks correctly skip plural checking when
 * the separator is null. A separator has to split a string into parts that all have
 * content, or it is just a pipe character inside prose.
 */
export function inferPluralSeparator(values) {
  for (const sep of SEPARATORS) {
    for (const v of values) {
      if (v.includes(sep) && v.split(sep).every((half) => strip(half))) return sep;
    }
  }
  return null;
}

/**
 * Fills in what the config did not state, from the source strings themselves. Returns
 * [config, inferredDescriptions] so a run can SAY what it guessed. `cfg` is a plain object;
 * `sourceFlat` a Map (or object) of strings.
 */
export function inferConfig(cfg, sourceFlat) {
  const flat = sourceFlat instanceof Map ? [...sourceFlat.values()] : Object.values(sourceFlat);
  const values = flat.filter((v) => typeof v === "string");
  const out = { ...cfg };
  const inferred = [];

  if (!truthy(out.placeholder)) {
    out.placeholder = inferPlaceholder(values);
    inferred.push(`placeholder ${out.placeholder.prefix}…${out.placeholder.suffix}`);
  }
  if (!dhas(out, "pluralSeparator")) {
    out.pluralSeparator = inferPluralSeparator(values);
    const sep = out.pluralSeparator;
    inferred.push(`pluralSeparator ${sep === null ? "none" : pyJson(sep)}`);
  }
  // `glossary` accepts a bare array as well as {"doNotTranslate": [...]} — the nesting
  // bought nothing and the array is what every config actually wants to write.
  if (Array.isArray(out.glossary)) out.glossary = { doNotTranslate: out.glossary };

  return [out, inferred];
}
