// SPDX-License-Identifier: MIT
// Terminology consistency — the check that reads the catalogue as its own glossary. The port
// of terms.py (ported from just-ai-help's `server/terms.js`).
//
// Every other check compares one string against its source; none can see the defect where a
// translation is perfectly good on its own and disagrees with the two thousand strings
// around it (measured: `guardado automático` used where the catalogue says `autoguardado`
// fifteen times, and nothing else in the pipeline could catch it).
//
// NOT A DICTIONARY. This check knows nothing about Spanish or any language — language rules
// written from memory are the thing conventions.json forbids about itself. It only knows what
// THIS catalogue already does, which makes it correct in every language for free, and wrong
// only in the direction of silence when a catalogue is too small to have conventions yet.
//
// THE THRESHOLDS ARE MEASURED, NOT PICKED TO FEEL SAFE (2,039-key catalogue, 2026-07-31):
// dominance 0.85 yields 30 advisory findings and still catches the defect the check was built
// for; 0.90 goes quiet by ceasing to work; below 0.85 the extras are polysemy. The 5-char stem
// is a MEASURED NECESSITY: without it, 102 findings, mostly inflection
// (`personaje`/`personajes`). Over-merging is the safe direction — a merged pair only ever
// removes a finding. All findings are ADVISORY, like `disagreement`.
//
// ORDER: Python's `terms()` is a set, so where two forms tie (the commonest target, the order
// of a key's findings, `term_usage` ties) Python's own answer follows string hash order and
// changes from run to run. The JavaScript uses first-occurrence order — one of Python's
// possible answers, and a stable one.

import { cpLen, cpSlice, pyGet, pyRound, pySorted } from "@delebash/llm-runner/platform/py";
import { asMap, dhas, pyStr } from "./jsonio.js";

export const DOMINANCE = 0.85;

const PLACEHOLDER = /\{[^}]*\}/gu;
const SPLIT = /[^\p{L}\p{N}]+/u; // [\W_]+ — anything but letters and digits

/**
 * Content words only. Five characters is a blunt instrument for skipping function words
 * without shipping a per-language stopword list — the lexical claim from memory this project
 * bans. A Set, in first-occurrence order.
 */
export function terms(text, minLen = 5) {
  const bare = pyStr(text).replace(PLACEHOLDER, " ").toLowerCase();
  return new Set(bare.split(SPLIT).filter((w) => cpLen(w) >= minLen));
}

/** A crude stem: the first five characters. Deliberately dumb — a real stemmer is
 * per-language. */
export function stem(w) {
  return cpSlice(w, 0, 5);
}

function stemsOf(text, minLen) {
  return new Set([...terms(text, minLen)].map(stem));
}

/** `max(d.items(), key=lambda kv: kv[1])` — the first of equals wins. */
function maxByCount(m) {
  let best = null;
  for (const [k, n] of m) if (best === null || n > best[1]) best = [k, n];
  return best;
}

/**
 * The catalogue's own glossary: source term → the target term that habitually accompanies
 * it, with the evidence. Counting is done on STEMS so inflections agree; the reported term is
 * the commonest full form — a finding names a word a human recognises, not a five-letter
 * fragment. Returns a Map.
 */
export function termIndex({ sourceFlat, targetFlat, minKeys = 4, dominance = DOMINANCE, minLen = 5 }) {
  const bySource = new Map();
  for (const [key, src] of asMap(sourceFlat)) {
    if (!dhas(targetFlat, key)) continue;
    for (const t of terms(src, minLen)) {
      if (!bySource.has(t)) bySource.set(t, []);
      bySource.get(t).push(key);
    }
  }

  const index = new Map();
  for (const [srcTerm, keys] of bySource) {
    if (keys.length < minKeys) continue;
    const counts = new Map();
    const forms = new Map();
    for (const key of keys) {
      const seen = new Set();
      for (const full of terms(pyGet(targetFlat, key), minLen)) {
        const s = stem(full);
        if (!seen.has(s)) {
          counts.set(s, (counts.get(s) ?? 0) + 1);
          seen.add(s);
        }
        if (!forms.has(s)) forms.set(s, new Map());
        forms.get(s).set(full, (forms.get(s).get(full) ?? 0) + 1);
      }
    }

    if (!counts.size) continue;
    const [bestStem, hits] = maxByCount(counts);
    const coverage = hits / keys.length;
    // Several fair renderings of a common word is the normal case, not a defect.
    if (coverage < dominance || hits < minKeys) continue;
    const commonest = maxByCount(forms.get(bestStem))[0];
    index.set(srcTerm, { target: commonest, stem: bestStem, hits, keys: keys.length, coverage });
  }
  return index;
}

/**
 * Findings for one key against an already-built index — split from the sweep so the review
 * panel can ask about the key on screen without rebuilding the index for two thousand keys
 * on every keystroke.
 */
export function checkKeyTerms({ key, src, dst, index, minLen = 5 }) {
  if (dst === null || dst === undefined) return [];
  const dstStems = stemsOf(dst, minLen);
  const out = [];
  for (const t of terms(src, minLen)) {
    const conv = index.get(t);
    if (conv === undefined || dstStems.has(conv.stem)) continue;
    out.push({
      key,
      code: "terminology",
      advisory: true,
      detail:
        `"${t}" is rendered "${conv.target}" in ${conv.hits} of ` +
        `${conv.keys} other keys (${pyRound(conv.coverage * 100)}%); ` +
        "this one does not use it",
      term: t,
      expected: conv.target,
    });
  }
  return out;
}

/**
 * Sweeps the whole catalogue. Returns findings AND the index — the caller usually wants
 * both, and building it twice on 2,039 keys is pure waste.
 */
export function checkTerms({ sourceFlat, targetFlat, minKeys = 4, dominance = DOMINANCE }) {
  const index = termIndex({ sourceFlat, targetFlat, minKeys, dominance });
  const findings = [];
  for (const [key, src] of asMap(sourceFlat)) {
    if (!dhas(targetFlat, key)) continue;
    findings.push(...checkKeyTerms({ key, src, dst: pyGet(targetFlat, key), index }));
  }
  return { findings, index };
}

/**
 * How a term is actually rendered across the catalogue — the honest form of the feature: the
 * check says "this disagrees with 15 other keys"; this says "here are those 15, go look" —
 * and sometimes the fifteen are the ones that are wrong.
 */
export function termUsage({ sourceFlat, targetFlat, term }) {
  const t = pyStr(term).toLowerCase();
  const counts = new Map();
  const examples = new Map();
  for (const [key, src] of asMap(sourceFlat)) {
    if (!dhas(targetFlat, key) || !terms(src).has(t)) continue;
    for (const tgt of terms(pyGet(targetFlat, key))) {
      counts.set(tgt, (counts.get(tgt) ?? 0) + 1);
      if (!examples.has(tgt)) examples.set(tgt, key);
    }
  }
  return pySorted([...counts], ([, n]) => -n).map(([tgt, n]) => ({ target: tgt, count: n, example: examples.get(tgt) }));
}
