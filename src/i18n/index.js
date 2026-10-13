// SPDX-License-Identifier: MIT
// vue-i18n setup — the family's shape (just-llm-runner/docs/app-structure.md §Q; the plan
// just-llm-runner/docs/plans/2026-10-12-i18n-standard.md). The instance starts from the kit's
// catalogs (`kit.*`) and this app's own (./locales/<code>.json) are merged over them, so a `kit.*`
// key here rewords the kit's: docgen's voice on the model catalog and Quick Setup lives that way.
// The instance is exported, not created in the boot file, because non-component code translates too.
import { createI18n } from "vue-i18n";
import { catalogsFromFiles, kitMessages } from "@delebash/llm-ui/i18n/index.js";

const own = catalogsFromFiles(import.meta.glob("./locales/*.json", { eager: true }));

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: kitMessages(),
  missingWarn: false,
  fallbackWarn: false,
});
for (const [code, msgs] of Object.entries(own)) i18n.global.mergeLocaleMessage(code, msgs);

// The app's languages — the codes of its own catalogs — for the language picker.
export const LOCALE_CODES = Object.keys(own);
