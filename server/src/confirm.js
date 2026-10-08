// SPDX-License-Identifier: MIT
// The confirmation pass — asking the engine about strings that came back unchanged. The port
// of confirm.py (ported from just-ai-help's `server/confirm.js`, measurements intact).
//
// `untranslated` fires when target == source, and a string comparison cannot separate four
// situations: a glyph ("A", "H2"), a name that stays English ("EPUB"), a word the language
// shares ("Color"), and THE MODEL SKIPPED IT ("books" should be "libros"). Only the fourth is
// a bug, and it hides inside a wall of the other three. The candidate set is free — the
// translate run already proved everything it CHANGED was translatable.
//
// MEASURED (JustWrite catalogue, 2026-07-31): 71 genuinely-identical keys → 57 cleared; 20/20
// planted long skips caught, 37/40 short ("?", "OK", "pan" falsely cleared — a ~7.5%
// false-clear rate on short strings, which is exactly why a cleared key stays VISIBLE and a
// human still presses the button).
//
// WHY IT NEVER WRITES A TRANSLATION: of 10 proposals, "{n} w" → "{n} min" invented minutes,
// "TODO" → "TODO POR HACER" mangled a do-not-translate term, and "elevator pitch" got two
// different answers in one run. A proposal is shown, never applied.
//
// THE ENGINE NEVER SIGNS OFF. Both outcomes are annotations in the workshop state; nothing
// here writes `<lang>.accepted.json` — that is the human record. A "same" verdict PRE-TICKS
// a row so seventy keys are one click; the approval recorded is still a person's.
//
// WHY NOT ASK TWICE: tried, and it agreed with itself confidently on BOTH wrong answers (4
// disagreements of 71). Single pass.

import { ValueError } from "@delebash/llm-runner/platform/py";
import { acceptanceHash } from "./accepted.js";
import * as engine from "./engine.js";
import { dget, dumps, errText, pyStr, pyStrip, pyTruthy, S } from "./jsonio.js";
import { parseItems } from "./shieldlib.js";

// The code the confirmation pass reasons about. Only `untranslated` has this ambiguity.
export const CONFIRM_CODE = "untranslated";

/**
 * Names the four situations explicitly rather than asking "is this right?" — a model asked
 * to judge itself agrees with itself. Asked to TRANSLATE, it does the job it is good at, and
 * answering "SAME" becomes a deliberate refusal, not a shrug.
 */
export function buildConfirmPrompt({ targetLang, context = "", doNotTranslate = null }) {
  const never = pyTruthy(doNotTranslate)
    ? `\nThese terms stay exactly as they are and are always SAME: ${doNotTranslate.join(", ")}.`
    : "";
  const ctx = pyTruthy(context) ? ` from ${context}` : "";
  return `You are checking ONE user-interface string${ctx}.

A translator was asked to translate it from English into ${targetLang} and returned it UNCHANGED.
Decide which of these happened.

It is genuinely unchanged when:
  - it is not words — a button glyph ("A", "H2", "B"), a unit ("5s", "12 w"), a symbol
  - it is a product, brand or file-format name that stays English (EPUB, JSON, RAG)
  - ${targetLang} simply uses the same word (for Spanish: Color, Error, total)

It was SKIPPED when the string is ordinary text that has a perfectly good ${targetLang} word.
"books" is not ${targetLang}. "Save" is not ${targetLang}.${never}

Reply with a single item whose translation field is EXACTLY one of:
  SAME                  — if it is genuinely unchanged
  the ${targetLang}     — if it was skipped, give the correct translation`;
}

/**
 * Echoing the source back counts as SAME — 15 of 71 answered that way in the measurement,
 * and scoring an echo as a proposed translation would turn the pass's best answers into
 * false alarms.
 */
export function isSameVerdict(answer, source) {
  // str(s or "").strip(), then trailing dots/whitespace off.
  const norm = (s) => pyStrip(pyStr(pyTruthy(s) ? s : "")).replace(TRAILING_DOTS, "");
  const a = norm(answer);
  return /^same$/iu.test(a) || a === norm(source);
}

const TRAILING_DOTS = new RegExp(`[.${S.slice(1)}+$`, "u"); // [.\s]+$

/**
 * The default transport: ONE key per call through the resolved preset — never batched,
 * because a batch is how the original skip happened and asking inside another batch invites
 * the model to repeat it for the same reason. Returns an async `ask(system, source)`.
 */
export function makeAsk(feature = "confirm") {
  const send = engine.makeSend(feature);
  return async function ask(system, source) {
    const user = `Translate items: ${dumps([{ id: 0, text: source }])}`;
    const answer = parseItems(await send(system, user)).get(0);
    if (typeof answer !== "string") {
      // ValueError on purpose: the MODEL's reply is what is invalid, and confirmIdentical
      // routes it into `failed` like any error.
      throw new ValueError("no item 0 in the reply");
    }
    return answer;
  };
}

/**
 * Runs the pass over every candidate key.
 *
 * Returns {cleared, proposed, failed}:
 *   cleared  — the model says correct-as-is. An ANNOTATION that pre-ticks the review row; it
 *              never reaches <lang>.accepted.json on its own.
 *   proposed — the model thinks it was skipped, and what it would have written. NEVER applied.
 *   failed   — the engine errored. Left as a finding, exactly like an exhausted retry.
 *
 * `ask` is injected because the routing decision (cleared vs proposed vs failed) is the part
 * worth asserting, and it should be assertable with no model running.
 */
export async function confirmIdentical({
  keys,
  sourceFlat,
  targetFlat,
  targetLang,
  context = "",
  doNotTranslate = null,
  ask,
  onProgress = null,
}) {
  const system = buildConfirmPrompt({ targetLang, context, doNotTranslate });
  const cleared = [];
  const proposed = [];
  const failed = [];

  for (const key of keys) {
    const src = dget(sourceFlat, key);
    try {
      const answer = await ask(system, src);
      if (isSameVerdict(answer, src)) cleared.push({ key, src, dst: dget(targetFlat, key) });
      else proposed.push({ key, src, dst: dget(targetFlat, key), suggestion: answer });
    } catch (e) {
      failed.push({ key, src, error: errText(e) }); // an engine error is a routed outcome
    }
    if (onProgress) onProgress({ done: cleared.length + proposed.length + failed.length, total: keys.length });
  }
  return { cleared, proposed, failed };
}

/**
 * Hangs the pass's annotation on the finding it belongs to, so the report and the review
 * workspace show the same thing without either calling an engine. A verdict whose hash no
 * longer matches is IGNORED — the same expiry an acceptance follows: edit either string and
 * the machine's opinion retires itself. The field is named `confirmed`, not `accepted`: it
 * pre-ticks a row for a human, it does not stand in for one.
 */
export function attachConfirmations(findings, verdicts, sourceFlat, targetFlat) {
  if (!pyTruthy(verdicts)) return findings;
  const out = [];
  for (const f of findings) {
    if (f.code !== CONFIRM_CODE || !Object.hasOwn(verdicts, f.key)) {
      out.push(f);
      continue;
    }
    const v = verdicts[f.key];
    const live = acceptanceHash({
      key: f.key,
      code: CONFIRM_CODE,
      src: dget(sourceFlat, f.key, ""),
      dst: dget(targetFlat, f.key, ""),
    });
    if (v.hash !== live) {
      out.push(f);
      continue;
    }
    const annotated = { ...f, confirmed: v.verdict, confirmedBy: v.engine };
    if (pyTruthy(v.suggestion)) annotated.suggestion = v.suggestion;
    out.push(annotated);
  }
  return out;
}
