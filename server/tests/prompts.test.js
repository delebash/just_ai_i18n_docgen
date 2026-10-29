// SPDX-License-Identifier: MIT
// The prompt rows (seed_feature_prompts.js), rendered by the kit with docgen's variables functions.
//
// THE GOLDEN BYTES: until 2026-10-29 docgen built these prompts in code (shieldlib.js buildSystemPrompt and
// buildUserMessage, confirm.js buildConfirmPrompt). The strings below are what those builders produced for these
// inputs, captured before they were deleted; the rows must render them to the byte. (Measured the same way on every
// batch of JustWrite's and docgen's own catalogues: 198/198 and 17/17, every optional field set and empty.)
//
// SHIELDED BEFORE IT RENDERS: the model sees ⟦n⟧ tokens, never a placeholder or a glossary term, and the kit's
// renderer never reads a value it inserts as a template — a context sentence holding "{{items}}" is sent as written.
import { render } from "@delebash/core/llm";
import { expect, test } from "vitest";
import { confirmVariables } from "../src/confirm.js";
import { placeholderRe } from "../src/jsonio.js";
import { translateLanguage } from "../src/loop.js";
import { BACKTRANSLATE_PROMPT, CONFIRM_PROMPT, TRANSLATE_PROMPT } from "../src/seed_feature_prompts.js";
import { DEFAULT_TEST_SAMPLES } from "../src/seed_test_samples.js";
import { backtranslateVariables, shield, translateVariables } from "../src/shieldlib.js";
import { createApp, seedLlmStack } from "../src/app.js";
import { testClient, tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

const RE = placeholderRe({ prefix: "{", suffix: "}" });
const TERMS = ["JustWrite", "EPUB"];
const SOURCES = [
  ["a.save", "Save {count} chapters to EPUB"],
  ["b.title", "JustWrite — {{evil}} $& ⟦9⟧"],
  ["c.plural", "one book | {n} books"],
];
const SHIELDED = SOURCES.map(([key, text], i) => ({ key, i, shielded: shield(text, RE, TERMS)[0] }));
const FULL = {
  sourceLanguage: "en",
  context: "a writing app",
  conventionsLine: "use ¿ and ¡ at the start of questions and exclamations",
  pluralSeparator: " | ",
  notes: new Map([["b.title", "the window's title"]]),
};

const GOLDEN = {
  fullSystem:
    'You are a professional software-UI translator, en→es. Rules: tokens like ⟦0⟧ are untouchable placeholders — reproduce each exactly once; never translate these terms: JustWrite, EPUB; use ¿ and ¡ at the start of questions and exclamations; a string containing " | " holds plural forms — translate each half and keep the separator; an item may carry a "note" — it describes how that string is used; follow it; output ONLY JSON matching the schema.',
  fullUser:
    'Context: a writing app. Translate items: [{"id": 0, "text": "Save ⟦0⟧ chapters to ⟦1⟧"}, {"id": 1, "text": "⟦1⟧ — ⟦0⟧} $& ⟦9⟧", "note": "the window\'s title"}, {"id": 2, "text": "one book | ⟦0⟧ books"}]',
  bareSystem:
    'You are a professional software-UI translator, en→fr. Rules: tokens like ⟦0⟧ are untouchable placeholders — reproduce each exactly once; an item may carry a "note" — it describes how that string is used; follow it; output ONLY JSON matching the schema.',
  bareUser:
    'Context: a software application. Translate items: [{"id": 0, "text": "Save ⟦0⟧ chapters to ⟦1⟧"}, {"id": 1, "text": "⟦1⟧ — ⟦0⟧} $& ⟦9⟧"}, {"id": 2, "text": "one book | ⟦0⟧ books"}]',
  confirmFull:
    'You are checking ONE user-interface string from a writing app.\n\nA translator was asked to translate it from English into es and returned it UNCHANGED.\nDecide which of these happened.\n\nIt is genuinely unchanged when:\n  - it is not words — a button glyph ("A", "H2", "B"), a unit ("5s", "12 w"), a symbol\n  - it is a product, brand or file-format name that stays English (EPUB, JSON, RAG)\n  - es simply uses the same word (for Spanish: Color, Error, total)\n\nIt was SKIPPED when the string is ordinary text that has a perfectly good es word.\n"books" is not es. "Save" is not es.\nThese terms stay exactly as they are and are always SAME: JustWrite, EPUB.\n\nReply with a single item whose translation field is EXACTLY one of:\n  SAME                  — if it is genuinely unchanged\n  the es     — if it was skipped, give the correct translation',
  confirmBare:
    'You are checking ONE user-interface string.\n\nA translator was asked to translate it from English into de and returned it UNCHANGED.\nDecide which of these happened.\n\nIt is genuinely unchanged when:\n  - it is not words — a button glyph ("A", "H2", "B"), a unit ("5s", "12 w"), a symbol\n  - it is a product, brand or file-format name that stays English (EPUB, JSON, RAG)\n  - de simply uses the same word (for Spanish: Color, Error, total)\n\nIt was SKIPPED when the string is ordinary text that has a perfectly good de word.\n"books" is not de. "Save" is not de.\n\nReply with a single item whose translation field is EXACTLY one of:\n  SAME                  — if it is genuinely unchanged\n  the de     — if it was skipped, give the correct translation',
};

test("the_translate_row_renders_todays_prompt_to_the_byte", () => {
  const full = translateVariables(SHIELDED, FULL, "es", TERMS);
  expect(render(TRANSLATE_PROMPT.system, full)).toBe(GOLDEN.fullSystem);
  expect(render(TRANSLATE_PROMPT.user, full)).toBe(GOLDEN.fullUser);
  // every optional field empty: each rule is left out whole, the context falls back
  const bare = translateVariables(SHIELDED, {}, "fr");
  expect(render(TRANSLATE_PROMPT.system, bare)).toBe(GOLDEN.bareSystem);
  expect(render(TRANSLATE_PROMPT.user, bare)).toBe(GOLDEN.bareUser);
});

test("the_confirm_row_renders_todays_prompt_to_the_byte", () => {
  const full = confirmVariables({ targetLang: "es", context: "a writing app", doNotTranslate: TERMS, source: "No" });
  expect(render(CONFIRM_PROMPT.system, full)).toBe(GOLDEN.confirmFull);
  expect(render(CONFIRM_PROMPT.user, full)).toBe('Translate items: [{"id": 0, "text": "No"}]');
  expect(render(CONFIRM_PROMPT.system, confirmVariables({ targetLang: "de", source: "No" }))).toBe(GOLDEN.confirmBare);
});

test("the_backtranslate_row_renders_todays_prompt_to_the_byte", () => {
  const v = backtranslateVariables("Guardar {n} libros", { sourceLanguage: "en" }, "es");
  expect(render(BACKTRANSLATE_PROMPT.system, v)).toBe(
    "You are a translator, es→en. Translate the text literally, preserving any {placeholders} exactly. Output ONLY JSON matching the schema.",
  );
  expect(render(BACKTRANSLATE_PROMPT.user, v)).toBe('Translate items: [{"id": 0, "text": "Guardar {n} libros"}]');
});

test("each_rows_lab_sample_fills_exactly_its_names_shielded", () => {
  const rows = { translate: TRANSLATE_PROMPT, confirm: CONFIRM_PROMPT, review: BACKTRANSLATE_PROMPT };
  expect(DEFAULT_TEST_SAMPLES.map((s) => s.action).sort()).toEqual(Object.keys(rows).sort());
  const names = (t) => [...t.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  for (const s of DEFAULT_TEST_SAMPLES) {
    const row = rows[s.action];
    const used = new Set([...names(row.system), ...names(row.user)]);
    expect(new Set(Object.keys(s.variables)), s.action).toEqual(used);
    expect(() => render(`${row.system}\n${row.user}`, s.variables), s.action).not.toThrow();
  }
  const translate = DEFAULT_TEST_SAMPLES.find((s) => s.action === "translate").variables;
  expect(translate.items, "the sample's strings are shielded as a run's are").toContain("⟦0⟧");
  expect(translate.items).not.toContain("{count}");
});

test("the_server_seeds_the_rows_and_lists_each_ones_lab_sample", async () => {
  const client = testClient(await createApp(tmpDir()));
  seedLlmStack();
  const { prompts } = (await client.get("/v1/ai/prompts")).json();
  expect(prompts.map((p) => p.key).sort()).toEqual(["confirm", "review", "translate"]);
  for (const s of DEFAULT_TEST_SAMPLES) {
    const { rows } = (await client.get("/v1/ai/test-samples", { params: { action: s.action } })).json();
    expect(rows.map((r) => r.label), s.action).toEqual([s.label]);
  }
});

test("the_strings_are_shielded_before_the_row_renders_and_a_value_is_never_read_as_a_template", async () => {
  // what the run's seam receives: exactly shield()'s output, the context as written
  const seen = [];
  const send = (vars) => {
    seen.push(vars);
    return JSON.stringify({ items: JSON.parse(vars.items).map((it) => ({ id: it.id, translation: it.text })) });
  };
  const cfg = { placeholder: { prefix: "{", suffix: "}" }, context: "an app — {{items}} {{lang}}", glossary: { doNotTranslate: ["JustWrite"] } };
  await translateLanguage({ sourceFlat: { a: "Open {name} in JustWrite" }, lang: "es", cfg, send, log: () => {} });
  const [vars] = seen;
  expect(JSON.parse(vars.items)).toEqual([{ id: 0, text: shield("Open {name} in JustWrite", RE, ["JustWrite"])[0] }]);

  // an adversarial row that uses every variable twice: still only tokens, the context verbatim
  const twice = Object.keys(vars).map((n) => `{{${n}}} {{${n}}}`).join("\n");
  const out = render(twice, vars);
  expect(out).toContain("Open ⟦0⟧ in ⟦1⟧");
  expect(out).not.toContain("{name}");
  expect(out).not.toMatch(/in JustWrite/);
  expect(out, "an inserted value is never rendered again").toContain("an app — {{items}} {{lang}}");
});
