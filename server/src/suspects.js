// SPDX-License-Identifier: MIT
// Layer 2b — the SUSPECT list. What the checks CANNOT see. The port of suspects.py (ported
// from just-ai-help's `server/suspects.js`).
//
// The checks are about FORM; a translation can pass every one and still be wrong — the two
// worst cases measured 2026-07-28 both did ("delete autosave NUMBER 3" for "delete 3
// autosaves", and an invented noun). A human reading Spanish catches both in seconds, which
// does not scale to 846 keys and does not exist at all for a language nobody on the team
// reads.
//
// THE SIGNAL: self-consistency. Translate the same key twice with the SAME model at non-zero
// temperature and compare — where the model is sure it repeats itself, where it guesses it
// wanders. Two DIFFERENT models was tried and is WORSE: they word everything differently, so
// real defects drown in stylistic noise.
//
// THE RANKING IS WEAK EVIDENCE AND THE SET IS THE OUTPUT. Re-measured at 1,965 keys: 150
// disagreed and the two genuine semantic defects ranked #22 and #30 of the 30 shown; the
// hidden 120 were not measurably less suspicious, just less wordy. Set topN above the
// disagreement count and READ THE LIST — topN costs display space, not engine time. Do not
// add ranking cleverness on the strength of small-corpus numbers.
//
// Findings come back in the SAME {key, code, detail} shape as every check, so the review page
// renders them and escalation re-translates them with no new concepts anywhere.

import { pySorted } from "@delebash/llm-runner/platform/py";
import { ALNUM, asMap, cpLen, cpSlice, dget, fmtFixed, pySplit, pyStr, S } from "./jsonio.js";

// [^\w\s]|_ — everything but letters, digits and (Python's) whitespace; the underscore is
// neither, so it is in.
const STRIP = new RegExp(`(?!${ALNUM})[^${S.slice(1)}`, "gu");

/** Word set, case- and punctuation-insensitive. Unicode-aware so accents survive. */
function tokens(s) {
  return new Set(pySplit(pyStr(s).toLowerCase().replace(STRIP, " ")));
}

/**
 * How far apart two renderings are: 0 = the same words, 1 = nothing in common. Token-set
 * Jaccard rather than string equality, so word-order and punctuation differences still
 * register while spacing does not.
 */
export function spread(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  let inter = 0;
  for (const t of x) if (y.has(t)) inter += 1;
  const union = x.size + y.size - inter;
  return union === 0 ? 0.0 : 1 - inter / union;
}

/**
 * Split keys into `bandCount` length bands using the corpus's OWN sorted source lengths — no
 * magic character constants, so a corpus of tooltips bands differently from a corpus of
 * paragraphs.
 */
function bandsOf(keys, sourceFlat, bandCount) {
  const ordered = pySorted(keys, (k) => cpLen(pyStr(dget(sourceFlat, k))));
  const size = Math.ceil(ordered.length / bandCount) || 1;
  const out = [];
  for (let i = 0; i < ordered.length; i += size) out.push(ordered.slice(i, i + size));
  return out;
}

function clip(s, n = 80) {
  s = pyStr(s);
  return cpLen(s) > n ? `${cpSlice(s, 0, n)}…` : s;
}

/**
 * Rank the keys whose two passes disagree and return the top `topN` as findings.
 *
 * Length-normalised: raw spread correlates with source length (r~0.42 measured), so a flat
 * ranking spends the whole budget on long paragraphs while the nastiest defects hide in
 * short strings. Bands hand over their next-highest-spread key round-robin, so short strings
 * get the same number of slots as long ones.
 *
 * A key whose two passes are IDENTICAL is never a suspect: that is the model telling us it is
 * sure, and it is the majority of any catalogue.
 */
export function rankSuspects({ sourceFlat, targetFlat, probeFlat, topN = 20, bandCount = 3 }) {
  const scored = [];
  for (const key of asMap(sourceFlat).keys()) {
    const a = dget(targetFlat, key);
    const b = dget(probeFlat, key);
    if (typeof a !== "string" || typeof b !== "string") continue;
    const s = spread(a, b);
    if (s === 0) continue;
    scored.push({ key, s, alt: b });
  }
  if (!scored.length || topN <= 0) return [];

  const byKey = new Map(scored.map((r) => [r.key, r]));
  const bands = bandsOf(
    scored.map((r) => r.key),
    sourceFlat,
    bandCount,
  );
  const queues = bands.map((band) =>
    pySorted(
      band.map((k) => byKey.get(k)),
      (r) => -r.s,
    ),
  );

  const picked = [];
  let i = 0;
  while (picked.length < topN) {
    let moved = false;
    for (const q of queues) {
      if (i < q.length) {
        picked.push(q[i]);
        moved = true;
        if (picked.length >= topN) break;
      }
    }
    if (!moved) break;
    i += 1;
  }

  return pySorted(picked, (r) => -r.s).map((r) => ({
    key: r.key,
    code: "disagreement",
    // The alternative rendering IS the useful part: a reviewer judges which is right by
    // seeing what the second pass said. A bare score sends them digging.
    detail: `a second pass wrote "${clip(r.alt)}" (spread ${fmtFixed(r.s, 2)})`,
  }));
}
