// SPDX-License-Identifier: MIT
// Port of tests/test_checks.py. Every check gets TWO cases: a clean string it must stay
// silent about, and a deliberately broken one it must complain about. The second is the
// point — a check that has never been seen to fail is indistinguishable from a check that
// cannot fail. Ported case-for-case from just-ai-help's `test/checks.test.js`; the broken
// strings are the MEASURED defects from the 2026-07 runs, verbatim.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildContext, checkOne, runChecks } from "../src/checks.js";

const CONVENTIONS = JSON.parse(readFileSync(join(import.meta.dirname, "..", "src", "config", "conventions.json"), "utf8"));

const CFG = {
  placeholder: { prefix: "{", suffix: "}" },
  pluralSeparator: "|",
  glossary: { doNotTranslate: ["JustWrite", "Strands"] },
};
const CTX = buildContext(CFG, CONVENTIONS, "es");

const codes = (src, dst) => checkOne({ key: "k", src, dst, ctx: CTX }).map((f) => f.code);

test("clean_translations_raise_nothing", () => {
  expect(codes("Delete {n} note?", "¿Eliminar {n} nota?")).toEqual([]);
  expect(codes("{n} note | {n} notes", "{n} nota | {n} notas")).toEqual([]);
  expect(codes("Open JustWrite", "Abrir JustWrite")).toEqual([]);
  expect(codes("Save", "Guardar")).toEqual([]);
});

test("placeholder_changed_bites_when_an_interpolation_is_rewritten", () => {
  // The exact defect lingo.dev produced on the corpus, 2026-07-27.
  expect(codes("{n} note | {n} notes", "{n} nota | {3} notas")).toContain("placeholder-changed");
  expect(codes("Move to {into}", "Mover a {dentro}")).toContain("placeholder-changed");
  expect(codes("Hello {name}", "Hola")).toContain("placeholder-changed");
});

test("plural_halves_lost_bites_when_a_form_disappears", () => {
  expect(codes("{n} note | {n} notes", "{n} notas")).toContain("plural-halves-lost");
});

test("plural_halves_identical_bites_the_one_nothing_else_catches", () => {
  // Right separator, right placeholders, right word count, and still wrong.
  const found = codes("Delete {n} autosave? | Delete {n} autosaves?", "¿Eliminar {n} autoguardados? | ¿Eliminar {n} autoguardados?");
  expect(found).toContain("plural-halves-identical");
});

test("glossary_translated_bites_when_a_brand_name_is_translated", () => {
  // "Strands" -> "Hilos", produced by both lingo.dev and one unshielded run, 2026-07-27.
  expect(codes("Strands", "Hilos")).toContain("glossary-translated");
  expect(codes("Open JustWrite now", "Abrir Escribir ahora")).toContain("glossary-translated");
});

test("glossary_matches_whole_words_never_inside_them", () => {
  // audit 2026-08-05: the substring test matched glossary terms INSIDE words — a false
  // finding when the term only appears inside a longer source word, and a false PASS when the
  // translation only carries it inside one.
  expect(codes("Stranded ships", "Barcos varados"), '"Strands" inside "Stranded" is not a glossary hit').toEqual([]);
  expect(codes("Strands here", "Stranded aquí"), '"Strands" inside dst "Stranded" must not count as surviving').toContain(
    "glossary-translated",
  );
});

test("untranslated_bites_on_a_skipped_string_but_not_a_shielded_only_one", () => {
  expect(codes("Chapters", "Chapters")).toContain("untranslated");
  // Shielded content is meant to come back unchanged. Flagging our own correct behaviour
  // would train people to ignore the report.
  expect(codes("Strands", "Strands")).toEqual([]);
  expect(codes("{count}", "{count}")).toEqual([]);
});

test("startpunc_bites_on_the_missing_spanish_opening_mark", () => {
  // Measured 5/5 failures on qwen3:8b and 5/5 on lingo.dev, rule in the prompt both times.
  expect(codes("Delete this chapter?", "Eliminar este capítulo?")).toContain("startpunc");
  expect(codes("Careful!", "Cuidado!")).toContain("startpunc");
  expect(codes("Delete this chapter?", "¿Eliminar este capítulo?")).toEqual([]);
});

test("spurious_interrogative_bites_when_the_model_invents_a_question", () => {
  // The real regression, measured on the full 846-key catalogue: 72 ¿ against 16 real
  // questions. These are verbatim from that run.
  expect(codes("Try tutorial project", "¿Probar proyecto de tutorial?")).toContain("spurious-interrogative");
  expect(codes("Statuses", "¿Estados?")).toContain("spurious-interrogative");
  expect(codes("Careful", "¡Cuidado!")).toContain("spurious-interrogative");
  // A genuine question keeps its marks and stays silent — the cure must not undo startpunc.
  expect(codes("Delete this chapter?", "¿Eliminar este capítulo?")).toEqual([]);
  expect(codes("Careful!", "¡Cuidado!")).toEqual([]);
});

test("startpunc_is_silent_for_a_language_with_no_conventions_row", () => {
  // Shipping rules we do not know is worse than shipping none.
  const frCtx = buildContext(CFG, CONVENTIONS, "fr");
  expect(checkOne({ key: "k", src: "Delete?", dst: "Supprimer ?", ctx: frCtx })).toEqual([]);
});

test("endpunc_bites_when_terminal_punctuation_is_dropped", () => {
  expect(codes("Saved.", "Guardado")).toContain("endpunc");
  expect(codes("Ready", "¿Listo?")).toContain("endpunc");
});

test("numbers_bites_when_a_quantity_changes", () => {
  expect(codes("Up to 500 words", "Hasta 50 palabras")).toContain("numbers");
  expect(codes("Up to 500 words", "Hasta 500 palabras")).toEqual([]);
});

test("brackets_bites_when_a_wrapper_is_dropped", () => {
  expect(codes("Chapter (draft)", "Capítulo (borrador")).toContain("brackets");
  expect(codes("See [docs]", "Ver docs")).toContain("brackets");
});

test("blank_bites_on_a_whitespace_only_translation", () => {
  expect(codes("Save", "   ")).toContain("blank");
});

test("doublewords_bites_on_a_stutter", () => {
  expect(codes("The book", "El el libro")).toContain("doublewords");
  expect(codes("It is what it is", "Es lo que es")).toEqual([]);
});

test("whitespace_bites_when_leading_or_trailing_spacing_changes", () => {
  expect(codes("Save ", "Guardar")).toContain("whitespace");
  expect(codes("Save", " Guardar")).toContain("whitespace");
});

test("missing_is_reported_for_a_key_with_no_translation_at_all", () => {
  const findings = runChecks({ sourceFlat: { "a.b": "Save", "a.c": "Open" }, targetFlat: { "a.b": "Guardar" }, ctx: CTX });
  expect(findings).toEqual([{ key: "a.c", code: "missing", detail: "no translation was written" }]);
});

test("every_finding_has_the_key_code_detail_shape_the_triage_feed_needs", () => {
  const findings = runChecks({ sourceFlat: { bad: "Delete {n} note?" }, targetFlat: { bad: "Eliminar {3} nota" }, ctx: CTX });
  expect(findings.length).toBeGreaterThanOrEqual(3);
  for (const f of findings) {
    expect(f.key).toBe("bad");
    expect(typeof f.code).toBe("string");
    expect(f.detail.length, `code ${f.code} produced an empty detail`).toBeGreaterThan(0);
  }
});
