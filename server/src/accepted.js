// SPDX-License-Identifier: MIT
// Accepted findings — the reviewer's verdict, made durable. The port of accepted.py (ported
// from just-ai-help's `server/accepted.js`).
//
// Some findings are correct output, not defects, and no check refinement will decide that
// for you: "No" → "No" is correct Spanish, "General" → "General" is a cognate, and a
// parenthetical gloss is a judgement call a human makes once. Across two full runs the
// `untranslated` check raised 20 findings of which exactly ONE was a real defect. A PERFECT
// catalogue could never exit 0 — and a gate that cannot go green is not a gate; people stop
// reading it, and that is precisely how the next real miss ships.
//
// NOT a per-language list of "words identical in Spanish" — that was the first design and it
// was wrong twice over (it only fixed one check, and it meant writing lexical claims from
// memory into config).
//
// An entry is keyed by a content hash of (key, code, source, target), the load-bearing
// property:
//   * Accepting `untranslated` on a key does NOT hide `brackets` on the same key.
//   * If the SOURCE changes, the hash changes and the finding comes back.
//   * If the TARGET changes — someone edits the translation — the finding comes back.
// And it is never silent: the count is always reported.

import { createHash } from "node:crypto";
import { FileNotFoundError, ValueError } from "@delebash/llm-runner/platform/py";
import { asMap, dget, dhas, dumps, OSError, readJson, toPlain, writeText } from "./jsonio.js";
import { exists } from "./paths.js";

// "unknown" on purpose, and NOT the OS username: an automated run under a developer's
// account would inherit their name and become indistinguishable from the developer's own
// judgement — the exact failure this field exists to make visible. (An agent once wrote 58
// verdicts into a real project's sidecar in bulk, and the format could not tell them from a
// human's review.)
export const UNKNOWN_REVIEWER = "unknown";

/**
 * The content hash for one finding. Includes the CODE so acceptances are per-defect, and
 * both strings so any edit to either side revives the finding. NUL-joined so "a|b"+"c" and
 * "a"+"b|c" can never collide — written as the ESCAPE, never the literal byte (see
 * checks.js's war story).
 */
export function acceptanceHash({ key, code, src, dst }) {
  const joined = `${key}\x00${code}\x00${src}\x00${dst}`;
  return createHash("sha1").update(joined, "utf8").digest("hex").slice(0, 16);
}

/**
 * Reads a sidecar, or an empty store if there is none. A corrupt file costs a re-review,
 * never a wrong pass — failing toward SHOWING the finding is the only safe direction.
 * `_`-prefixed keys are skipped so a file from an older version loads. Returns a plain
 * object {hash: entry} (a 16-hex hash is never an integer-like key).
 */
export function loadAccepted(p) {
  if (!exists(p)) return {};
  let raw;
  try {
    raw = readJson(p);
  } catch (e) {
    if (e instanceof ValueError || e instanceof OSError || e instanceof FileNotFoundError) return {};
    throw e;
  }
  // A non-dict file raises, as `raw.items()` does (its AttributeError isn't caught).
  const out = {};
  for (const [k, v] of asMap(raw)) if (!k.startsWith("_")) out[k] = toPlain(v);
  return out;
}

/** Writes the file, entries sorted so the diff is stable. Data only — the prose about what
 * this file is for lives in the docs, never in the JSON. */
export function saveAccepted(p, entries) {
  const ordered = new Map(Object.entries(entries).sort(([a], [b]) => cmpStr(a, b)));
  writeText(p, `${dumps(ordered, { indent: 2, ensureAscii: false })}\n`);
}

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0; // hex hashes: UTF-16 order is code-point order
}

/**
 * Splits findings into what still counts and what a reviewer has already cleared. Cleared
 * findings are RETURNED, never dropped — the caller can always report them.
 */
export function partitionAccepted(findings, accepted, sourceFlat, targetFlat) {
  const kept = [];
  const cleared = [];
  for (const f of findings) {
    const h = acceptanceHash({
      key: f.key,
      code: f.code,
      src: dget(sourceFlat, f.key, ""),
      dst: dget(targetFlat, f.key, ""),
    });
    if (dhas(accepted, h)) cleared.push({ ...f, hash: h });
    else kept.push(f);
  }
  return [kept, cleared];
}

/** Today's date in UTC, "YYYY-MM-DD" (`datetime.now(tz=utc).date().isoformat()`). */
const utcDate = () => new Date().toISOString().slice(0, 10);

/**
 * The stored entry for one finding — readable in a diff, so a reviewer can audit what was
 * waved through. `by` and `at` are PROVENANCE and deliberately OUTSIDE the hash: the hash
 * identifies the finding; who signed it off is metadata about that identity, so
 * re-accepting under a different name updates one entry rather than creating a second.
 */
export function acceptanceEntry({ key, code, src, dst, by = "", at = "" }) {
  return { key, code, src, dst, by: by || UNKNOWN_REVIEWER, at: at || utcDate() };
}
