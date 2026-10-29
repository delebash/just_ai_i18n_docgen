// SPDX-License-Identifier: MIT
// The default prompt of each AI action (app-structure §8, §11: a "prompt-row-owned" feature) — seeded into the
// shared `feature_prompts` table insert-if-missing, then read from the database on every run, so the AI Lab can edit
// and save it, and run by the kit's runAction (engine.js makeSend). JustWrite's and house-paint's
// seed_feature_prompts.js shape: keyed by the ACTION id, which is its routing `feature` too — so the run and the
// probe's temperature guard resolve the same preset (engine.js). Each row's `user_template` and `system` carry
// {{variables}} the caller fills (shieldlib.js translateVariables / backtranslateVariables, confirm.js
// confirmVariables), and its JSON contract: `json_mode` with RESPONSE_SCHEMA, which the kit sends as the OpenAI
// `response_format` every adapter translates for its provider (AGENTS.md: a hand-built `format` key was ignored).
// Every tunable is the engine preset's (app.js DEFAULT_ENGINE_PRESETS), never the prompt's.
//
// Until 2026-10-29 docgen built these prompts in code (featurePrompts: {}) and the Lab showed a read-only preview.
// The texts are those builders' to the byte (measured on all 199 of JustWrite's batches and all 16 of docgen's,
// with every optional field set and empty); tests/prompts.test.js holds them.
//
// THE OPTIONAL RULES ARE COMPOSED IN CODE, not written into the row: a rule that doesn't apply is left out whole
// ({{glossary_rule}} is "" or "; never translate these terms: …"). Written into the row with only the values as
// variables, an empty glossary left a false instruction behind ("never translate these terms: ;") — the
// false-instruction failure the plural rule's note in shieldlib.js describes (JustWrite's {{world_rules_section}}
// is the same pattern).
//
// Every rule in the translate prompt exists because something got it wrong on the corpus: placeholders (lingo.dev
// wrote {3}), the glossary (it wrote "Hilos" for "Strands"), the conventions line (qwen3 missed the opening ¿ 5/5),
// and plural pipes (an engine that splits the halves apart translates them inconsistently). The confirm prompt
// names the four situations explicitly rather than asking "is this right?" (confirm.js says why).
//
// The prompt text is what the model reads, so it stays English on purpose (§Q.11).

import { RESPONSE_SCHEMA } from "./shieldlib.js";

const SCHEMA = JSON.stringify(RESPONSE_SCHEMA, null, 2);

export const TRANSLATE_PROMPT = Object.freeze({
  system:
    "You are a professional software-UI translator, {{source}}→{{lang}}. Rules: tokens like ⟦0⟧ are untouchable " +
    "placeholders — reproduce each exactly once{{glossary_rule}}{{conventions_rule}}{{plural_rule}}; an item may " +
    'carry a "note" — it describes how that string is used; follow it; output ONLY JSON matching the schema.',
  user: "Context: {{context}}. Translate items: {{items}}",
});

export const CONFIRM_PROMPT = Object.freeze({
  system: `You are checking ONE user-interface string{{from_context}}.

A translator was asked to translate it from English into {{lang}} and returned it UNCHANGED.
Decide which of these happened.

It is genuinely unchanged when:
  - it is not words — a button glyph ("A", "H2", "B"), a unit ("5s", "12 w"), a symbol
  - it is a product, brand or file-format name that stays English (EPUB, JSON, RAG)
  - {{lang}} simply uses the same word (for Spanish: Color, Error, total)

It was SKIPPED when the string is ordinary text that has a perfectly good {{lang}} word.
"books" is not {{lang}}. "Save" is not {{lang}}.{{glossary_line}}

Reply with a single item whose translation field is EXACTLY one of:
  SAME                  — if it is genuinely unchanged
  the {{lang}}     — if it was skipped, give the correct translation`,
  user: "Translate items: {{items}}",
});

// Review's back-translation: the target string rendered back into the source language, never written anywhere.
export const BACKTRANSLATE_PROMPT = Object.freeze({
  system:
    "You are a translator, {{lang}}→{{source}}. Translate the text literally, preserving any {placeholders} " +
    "exactly. Output ONLY JSON matching the schema.",
  user: "Translate items: {{items}}",
});

const row = (feature, prompt) => ({
  feature,
  system: prompt.system,
  user_template: prompt.user,
  json_mode: true,
  json_schema: SCHEMA,
});

export const DEFAULT_FEATURE_PROMPTS = {
  translate: row("translate", TRANSLATE_PROMPT),
  confirm: row("confirm", CONFIRM_PROMPT),
  review: row("review", BACKTRANSLATE_PROMPT),
};
