// SPDX-License-Identifier: MIT
// The AI Lab's built-in test inputs (installLlm `testSamples`, the kit's TestSampleStore — JustWrite's
// DEFAULT_TEST_SAMPLES shape): one per prompt row (seed_feature_prompts.js), so each can be tried in the Lab's
// **Sample** button with no project loaded. A loaded project's own strings come in through the Lab's language
// picker instead (src/services/labTestData.js, GET /v1/ai/test-variables). Each sample's variables come from the
// same functions a run calls — shielded before they render, as a run's are — over a small fixed English batch.
// Seeded fill-if-missing, so a sample edited in the Lab stays as edited. The 2026-08-05 decision ("test_samples
// seeds so every feature is Lab-testable"), built 2026-10-29.
//
// What the model reads stays English on purpose (§Q.11).

import { confirmVariables } from "./confirm.js";
import { placeholderRe } from "./jsonio.js";
import { backtranslateVariables, shield, translateVariables } from "./shieldlib.js";

const PLACEHOLDER = placeholderRe({ prefix: "{", suffix: "}" });
const TERMS = ["EPUB"];
const CFG = {
  sourceLanguage: "en",
  context: "a desktop app where novelists write their books",
  pluralSeparator: " | ",
};
const BATCH = ["Save {count} chapters to EPUB", "Delete this book?", "one note | {n} notes"].map((text, i) => ({
  key: `sample.${i}`,
  i,
  shielded: shield(text, PLACEHOLDER, TERMS)[0],
}));

export const DEFAULT_TEST_SAMPLES = [
  { action: "translate", label: "Three strings into Spanish", variables: translateVariables(BATCH, CFG, "es", TERMS) },
  {
    action: "confirm",
    label: "A word Spanish shares",
    variables: confirmVariables({ targetLang: "es", context: CFG.context, doNotTranslate: TERMS, source: "Color" }),
  },
  { action: "review", label: "A Spanish string back into English", variables: backtranslateVariables("Guardar {count} capítulos en EPUB", CFG, "es") },
];
