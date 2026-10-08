// SPDX-License-Identifier: MIT
// Port of tests/test_infer.py — inference from the source catalogue: an explicit config
// value always wins, an inferred one is REPORTED, and null is a real answer for a catalogue
// with no plural forms.
import { expect, test } from "vitest";
import { inferConfig, inferPlaceholder, inferPluralSeparator } from "../src/infer.js";

test("placeholder_inference_counts_matches_and_double_braces_beat_single", () => {
  expect(inferPlaceholder(["Hello {name}", "Save {n}"])).toEqual({ prefix: "{", suffix: "}" });
  expect(inferPlaceholder(["Hello {{name}}", "Save {{n}}"])).toEqual({ prefix: "{{", suffix: "}}" });
  // One literal {{ in prose must not flip a vue-i18n catalogue to i18next.
  expect(inferPlaceholder(["{a}", "{b}", "{c}", "literal {{x}} once"])).toEqual({ prefix: "{", suffix: "}" });
  // Nothing at all → the most common default.
  expect(inferPlaceholder(["Save", "Open"])).toEqual({ prefix: "{", suffix: "}" });
});

test("plural_separator_none_is_a_real_answer", () => {
  expect(inferPluralSeparator(["{n} note | {n} notes"])).toBe(" | ");
  expect(inferPluralSeparator(["Save", "Open"])).toBeNull();
  // A pipe inside prose with an empty half is not a separator.
  expect(inferPluralSeparator(["a | "])).toBeNull();
});

test("infer_config_reports_what_it_guessed_and_explicit_values_win", () => {
  const [cfg, inferred] = inferConfig({}, { a: "Hi {n}", b: "{n} x | {n} y" });
  expect(cfg.placeholder).toEqual({ prefix: "{", suffix: "}" });
  expect(cfg.pluralSeparator).toBe(" | ");
  expect(inferred.length, "both guesses are SAID, never silent").toBe(2);

  const explicit = { placeholder: { prefix: "%{", suffix: "}" }, pluralSeparator: null };
  const [cfg2, inferred2] = inferConfig(explicit, { a: "Hi {n}" });
  expect(cfg2.placeholder, "explicit wins").toEqual({ prefix: "%{", suffix: "}" });
  expect(cfg2.pluralSeparator, "an explicit None is respected, not re-inferred").toBeNull();
  expect(inferred2).toEqual([]);
});

test("a_bare_glossary_array_is_normalised", () => {
  const [cfg] = inferConfig({ glossary: ["JustWrite"] }, { a: "x" });
  expect(cfg.glossary).toEqual({ doNotTranslate: ["JustWrite"] });
});
