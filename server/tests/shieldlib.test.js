// SPDX-License-Identifier: MIT
// Port of tests/test_shieldlib.py — the loop's pure parts, tested without a model: shielding,
// restore, the prompt (ported from just-ai-help's `test/loop.test.js` minus the
// buildRequest/effectiveTemperature cases — the request body belongs to the kit's
// adapters, and per-request temperature to the engine preset). The prompt is the seeded
// translate row rendered by the kit with translateVariables (2026-10-29); its exact bytes are
// tests/prompts.test.js's.
import { render } from "@delebash/core/llm";
import { expect, test } from "vitest";
import { placeholderRe } from "../src/jsonio.js";
import { TRANSLATE_PROMPT } from "../src/seed_feature_prompts.js";
import { parseItems, restore, shield, translateVariables } from "../src/shieldlib.js";

const RE = placeholderRe({ prefix: "{", suffix: "}" });
const itemsOf = (vars) => JSON.parse(vars.items);

/** The translate row's system prompt for `cfg` (sourceLanguage, conventionsLine, pluralSeparator) into `lang`. */
const systemPrompt = (cfg, lang, terms = null) => render(TRANSLATE_PROMPT.system, translateVariables([], cfg, lang, terms));
/** The translate row's user message for a batch. */
const userMessage = (shielded, cfg) => render(TRANSLATE_PROMPT.user, translateVariables(shielded, cfg, "es"));

test("shield_swaps_interpolations_and_restore_puts_them_back", () => {
  const src = 'Its {n} chapter will move to "{into}". | Its {n} chapters will move to "{into}".';
  const [shielded, tokens] = shield(src, RE);
  expect(shielded).toBe('Its ⟦0⟧ chapter will move to "⟦1⟧". | Its ⟦2⟧ chapters will move to "⟦3⟧".');
  expect(tokens).toEqual(["{n}", "{into}", "{n}", "{into}"]);
  expect(restore(shielded, tokens)).toBe(src);
});

test("restore_returns_none_when_a_token_is_lost_duplicated_or_invented", () => {
  const [, tokens] = shield("a {x} b {y}", RE);
  expect(restore("solo ⟦0⟧", tokens), "lost a token").toBeNull();
  expect(restore("⟦0⟧⟦0⟧⟦1⟧", tokens), "duplicated a token").toBeNull();
  expect(restore("⟦0⟧⟦1⟧⟦9⟧", tokens), "invented a token").toBeNull();
});

test("restore_tolerates_a_model_adding_spaces_inside_the_brackets", () => {
  const [, tokens] = shield("a {x}", RE);
  expect(restore("hola ⟦ 0 ⟧", tokens)).toBe("hola {x}");
});

test("glossary_terms_are_shielded_too_the_measured_strands_hilos_failure", () => {
  const [shielded, tokens] = shield("Open JustWrite Strands", RE, ["JustWrite", "Strands"]);
  expect(shielded).toBe("Open ⟦0⟧ ⟦1⟧");
  expect(restore(shielded, tokens)).toBe("Open JustWrite Strands");
});

test("a_glossary_term_inside_a_longer_word_is_left_alone", () => {
  const [shielded] = shield("Strandsville and Strands", RE, ["Strands"]);
  expect(shielded).toBe("Strandsville and ⟦0⟧");
});

test("longer_glossary_terms_win_over_shorter_ones_they_contain", () => {
  const [shielded, tokens] = shield("Ask the book now", RE, ["Ask", "Ask the book"]);
  expect(shielded).toBe("⟦0⟧ now");
  expect(restore(shielded, tokens)).toBe("Ask the book now");
});

test("the_prompt_carries_every_rule_and_drops_the_empty_slots", () => {
  const full = systemPrompt(
    { sourceLanguage: "en", conventionsLine: "Spanish opens questions with ¿", pluralSeparator: "|" },
    "es",
    ["JustWrite"],
  );
  expect(full).toContain("en→es");
  expect(full).toContain("untouchable placeholders");
  expect(full).toContain("never translate these terms: JustWrite");
  expect(full).toContain("Spanish opens questions with ¿");
  expect(full).toContain("plural forms");

  const bare = systemPrompt({ sourceLanguage: "en" }, "fr");
  expect(bare).not.toContain("never translate these terms");
  expect(bare, "an empty slot must not leave a dangling separator").not.toContain("; ;");
  expect(bare, "nor a rule with nothing in it").not.toContain("terms: ;");
});

test("bites_the_plural_rule_is_built_from_the_configured_separator", () => {
  // This rule was the literal `" | "` for the whole life of the Node tool, which made
  // pluralSeparator a half-honoured setting: the checks split on YOUR value while the model
  // was told about a pipe.
  const semi = systemPrompt({ sourceLanguage: "en", pluralSeparator: ";;" }, "de");
  expect(semi, "the prompt must name the separator the checks will enforce").toContain('";;"');
  expect(semi, "the old hardcoded pipe must be gone").not.toContain('" | "');
});

test("bites_a_catalogue_with_no_plural_forms_is_not_told_about_a_separator", () => {
  // i18next keeps plurals as separate keys, so a null separator is legitimate — telling the
  // model that some character marks plural forms is then simply a false instruction.
  const none = systemPrompt({ sourceLanguage: "en", pluralSeparator: null }, "ja");
  expect(none).not.toContain("plural forms");
  expect(none).not.toContain("; ;");
});

// ── Per-key notes ────────────────────────────────────────────────────────────
// The feedback loop that closes the review workspace: a note written while fixing a key is
// sent WITH that key next time, so the same defect does not have to be found twice.

test("a_note_is_attached_to_its_key_and_to_no_other", () => {
  const vars = translateVariables(
    [
      { i: 0, key: "characterAudit.why", shielded: "Why:" },
      { i: 1, key: "settings.save", shielded: "Save" },
    ],
    { context: "an app", notes: { "characterAudit.why": "a label above the reasoning, not a question" } },
    "es",
  );
  const items = itemsOf(vars);
  expect(items[0].note).toBe("a label above the reasoning, not a question");
  expect("note" in items[1], "an un-noted key must not carry one").toBe(false);
});

test("no_notes_at_all_changes_nothing_about_the_message", () => {
  const shielded = [{ i: 0, key: "a", shielded: "Save" }];
  expect(userMessage(shielded, { context: "an app" })).toBe(userMessage(shielded, { context: "an app", notes: {} }));
});

test("the_system_prompt_tells_the_model_what_a_note_is", () => {
  const p = systemPrompt({ sourceLanguage: "en" }, "es");
  expect(p, "a field the model is never told about is a field it ignores").toContain("note");
});

test("parse_items_reads_clean_json_and_salvages_a_fenced_reply", () => {
  const clean = JSON.stringify({ items: [{ id: 0, translation: "Hola" }] });
  expect(parseItems(clean)).toEqual(new Map([[0, "Hola"]]));
  const fenced = `\`\`\`json\n${clean}\n\`\`\``;
  expect(parseItems(fenced)).toEqual(new Map([[0, "Hola"]]));
});
