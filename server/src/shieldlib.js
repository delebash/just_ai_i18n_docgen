// SPDX-License-Identifier: MIT
// Placeholder shielding + the translation prompt — the pure heart of the loop. The port of
// shieldlib.py (ported from just-ai-help's `server/loop.js`, minus the transport: the request
// body belongs to llm-runner's adapters, and per-request temperature belongs to the engine
// preset each feature points at).
//
// SHIELDING IS A SUBSTITUTION, NOT AN INSTRUCTION. Interpolations — and do-not-translate
// terms — are swapped for ⟦0⟧-style tokens before the model sees them and restored by index
// afterwards. Told in the system prompt by name never to translate "Strands", lingo.dev's
// qwen3:8b run wrote "Hilos", and so did one run of the owned loop while another run of the
// identical code got it right. A rule the model may or may not follow is not a guarantee; a
// substitution is. And an index is checkable: a restored string that does not carry every
// token exactly once is a FAILURE routed to retry, never a result.
//
// The brackets are U+27E6/U+27E7 (MATHEMATICAL WHITE SQUARE BRACKET) — they occur in no UI
// string and no natural language, so a false positive is not possible.

import { createHash } from "node:crypto";
import { pySorted, ValueError } from "@delebash/llm-runner/platform/py";
import { PyFloat } from "@delebash/llm-runner/platform/pyjson";
import { ALNUM, cpLen, cpSlice, D, dget, dumps, JSONDecodeError, loads, pyIntDigits, pyStr, pyTruthy, reEscape, S } from "./jsonio.js";

// Tolerant of a model inserting spaces inside the brackets. Python's `\s` and `\d` are
// Unicode: a model that writes the index in Arabic-Indic digits ("⟦٣⟧") still restores.
const SHIELD_RE = new RegExp(`⟦${S}*(${D}+)${S}*⟧`, "gu");

// Letters+digits boundary, matching the JS original's `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`.
// Python's `[^\W_]` is exactly unicode letters+digits.
const bounded = (term) => new RegExp(`(?<!${ALNUM})${reEscape(term)}(?!${ALNUM})`, "gu");

/**
 * The ONE definition of "this term occurs here" — shared by shield() and checkGlossary so
 * they can never disagree (audit 2026-08-05: the check used a bare substring while shield
 * used this boundary, so a term inside a longer word was left alone by one and flagged — or
 * silently passed — by the other).
 */
export function termPresent(term, text) {
  return bounded(term).test(text);
}

/**
 * Replaces each interpolation — and each do-not-translate term — with an indexed shield
 * token. Terms are matched longest-first so a term that contains another is shielded whole,
 * and only at non-letter boundaries so a brand name inside a longer word is left alone.
 * Returns [shieldedText, tokens].
 */
export function shield(text, placeholderPattern, terms = null) {
  const tokens = [];
  const take = (m) => {
    tokens.push(m);
    return `⟦${tokens.length - 1}⟧`;
  };
  let shielded = text.replace(placeholderPattern, take);
  for (const term of pySorted(terms || [], (t) => cpLen(t), true)) {
    shielded = shielded.replace(bounded(term), take);
  }
  return [shielded, tokens];
}

/**
 * Restores shield tokens. Returns null when the model did not reproduce every token exactly
 * once — a null here is what routes the item into the retry path.
 */
export function restore(text, tokens) {
  const seen = new Set();
  let bad = false;
  const restored = text.replace(SHIELD_RE, (_m, digits) => {
    const i = pyIntDigits(digits);
    if (i >= tokens.length || seen.has(i)) {
      bad = true;
      return "";
    }
    seen.add(i);
    return tokens[i];
  });
  if (bad || seen.size !== tokens.length) return null;
  return restored;
}

// ── the prompt ───────────────────────────────────────────────────────────────
// One template, slots filled from config. Every rule in it exists because something got it
// wrong on the corpus: placeholders (lingo.dev wrote {3}), the glossary (it wrote "Hilos" for
// "Strands"), the conventions line (qwen3 missed the opening ¿ 5/5), and plural pipes (an
// engine that splits the halves apart translates them inconsistently).

/**
 * The system half. The plural rule is BUILT FROM THE CONFIGURED SEPARATOR and omitted
 * entirely when a catalogue has none — it used to be the literal `" | "`, which made
 * pluralSeparator a half-honoured setting: the checks split on your value while the model
 * was told about a pipe. i18next catalogues legitimately have no separator (plurals are
 * separate keys), and telling the model one exists is a false instruction.
 */
export function buildSystemPrompt({
  source,
  targetLang,
  doNotTranslate = null,
  conventionsLine = "",
  pluralSeparator = null,
}) {
  const pluralRule = pyTruthy(pluralSeparator)
    ? `a string containing "${pluralSeparator}" holds plural forms — translate each half and keep the separator`
    : "";
  const rules = [
    "tokens like ⟦0⟧ are untouchable placeholders — reproduce each exactly once",
    pyTruthy(doNotTranslate) ? `never translate these terms: ${doNotTranslate.join(", ")}` : "",
    conventionsLine,
    pluralRule,
    'an item may carry a "note" — it describes how that string is used; follow it',
    "output ONLY JSON matching the schema",
  ].filter((r) => pyTruthy(r));
  return `You are a professional software-UI translator, ${source}→${targetLang}. Rules: ${rules.join("; ")}.`;
}

/**
 * The user half: the catalogue's context line, then the items.
 *
 * PER-KEY NOTES live here. `cfg.context` is one sentence for the ENTIRE catalogue, so a
 * four-character label and a two-hundred-character paragraph arrive with identical context
 * — that is how `characterAudit.why` (EN "Why:", a label above a reasoning block) came back
 * as "¿Por qué?", a question. A note is written by a reviewer for a key they are ALREADY
 * fixing, so the fix compounds instead of recurring; only keys that have one carry the
 * field, so batches do not grow for the 99% that need nothing.
 */
export function buildUserMessage(shieldedItems, cfg) {
  const notesRaw = dget(cfg, "notes");
  const notes = pyTruthy(notesRaw) ? notesRaw : new Map();
  const items = [];
  for (const s of shieldedItems) {
    const item = { id: s.i, text: s.shielded };
    const note = s.key === undefined ? null : dget(notes, s.key);
    if (pyTruthy(note)) item.note = note;
    items.push(item);
  }
  const ctx = dget(cfg, "context");
  const context = pyTruthy(ctx) ? ctx : "a software application";
  return `Context: ${pyStr(context)}. Translate items: ${dumps(items, { ensureAscii: false })}`;
}

// The response contract. Ids come back so a reordered or partial answer is detectable rather
// than silently misaligned. Handed to the engine as the structured-output schema.
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          translation: { type: "string" },
        },
        required: ["id", "translation"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/** `isinstance(v, int)` on a loads() value — a bool IS an int in Python, a float is not. */
function pyIntKey(v) {
  if (v === true) return 1; // {"id": true} is item 1 (True == 1 as a dict key)
  if (v === false) return 0;
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v;
  if (typeof v === "number" && Number.isInteger(v) && !(v instanceof PyFloat)) return v;
  return undefined;
}

/**
 * Parses the model's JSON into Map{id: translation}. Some servers wrap JSON in a fence even
 * under a schema — one salvage attempt, then fail loudly.
 */
export function parseItems(content) {
  let parsed;
  try {
    parsed = loads(content);
  } catch (e) {
    if (!(e instanceof JSONDecodeError)) throw e;
    const m = /\{[\s\S]*\}/.exec(content);
    if (!m) throw new ValueError(`Response was not JSON: ${cpSlice(content, 0, 200)}`);
    parsed = loads(m[0]);
  }
  const items = parsed instanceof Map ? dget(parsed, "items") : null;
  if (!Array.isArray(items)) {
    // ValueError on purpose: the caller passed a fine string — it is the MODEL's reply that
    // is invalid, and the retry ladder catches ValueError.
    throw new ValueError("Response JSON had no `items` array.");
  }
  const out = new Map();
  for (const it of items) {
    if (!(it instanceof Map)) continue;
    const id = pyIntKey(dget(it, "id"));
    const tr = dget(it, "translation");
    if (id !== undefined && typeof tr === "string") out.set(id, tr);
  }
  return out;
}

// ── cache key ────────────────────────────────────────────────────────────────
// The delta. A key is skipped when its target already exists AND the hash of everything that
// could change its translation is unchanged: the source text, the language, the context
// sentence and the glossary. Change the context and every key re-translates — correct,
// because the context is part of the instruction the translation came from.

export function sha1(s) {
  return createHash("sha1").update(s, "utf8").digest("hex");
}

export function cacheKey({ text, lang, contextHash, glossaryHash }) {
  return sha1(`${text}|${lang}|${contextHash}|${glossaryHash}`);
}
