// SPDX-License-Identifier: MIT
// The AI Lab's test input (the kit's configureTestData, §7.3 — JustWrite's services/labTestData.js shape): one
// listable source, the project's languages, and per action a picker that fills the prompt row's {{variables}} from
// a small live sample of the picked language — the server builds them with the same functions a real run calls
// (GET /v1/ai/test-variables, server/src/workspace.js labVariables), so a Lab test sends what production sends.
// Registered in boot/docgen.js. It replaced the read-only prompt preview (2026-10-29), when translate, confirm and
// review became editable prompt rows.
import { get } from "@delebash/ui";
import { langLabel } from "./langs.js";

export const LAB_TEST_SOURCES = [
  {
    id: "langs",
    labelKey: "lab.source.language",
    kindKey: "lab.source.language",
    // read when the picker shows (the kit re-reads it on each visit): the loaded project's target languages
    async list() {
      const { langs } = await get("/v1/state");
      return (langs || []).map((code) => ({ id: code, label: langLabel(code) }));
    },
  },
];

/** A picker over the project's languages that fills `action`'s variables. */
const fromLanguage = (action) => ({
  pickers: [
    {
      source: "langs",
      fill: async (lang) => (await get(`/v1/ai/test-variables?action=${encodeURIComponent(action)}&lang=${encodeURIComponent(lang)}`)).variables,
    },
  ],
});

export const LAB_TEST_ACTIONS = {
  translate: fromLanguage("translate"),
  confirm: fromLanguage("confirm"),
  review: fromLanguage("review"),
};
