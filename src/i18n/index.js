// SPDX-License-Identifier: MIT
// vue-i18n setup — the family's shape (just-core/docs/app-structure.md §Q; the plan
// just-core/docs/plans/2026-10-12-i18n-standard.md). The instance starts from the kit's
// catalogs (`kit.*`) and this app's own (./locales/<code>.json) are merged over them, so a `kit.*`
// key here rewords the kit's: docgen's voice on the model catalog and Quick Setup lives that way.
// The instance is exported, not created in the boot file, because non-component code translates too.
import { createI18n } from "vue-i18n";
import { catalogsFromFiles, kitMessages } from "@delebash/ui/i18n/index.js";

const own = catalogsFromFiles(import.meta.glob("./locales/*.json", { eager: true }));

// Named date formats (vue-i18n's datetimeFormats), JustWrite's shape: the Intl options are the same in every
// language — Intl writes each one's order and names — but every language lists them, since vue-i18n formats a
// named format in the language it found it in.
const dateFormats = {
  // a date and time to the second (Runs' history)
  dateTime: { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" },
  // a date and time to the minute (Home's last run)
  dateTimeShort: { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" },
};

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: kitMessages(),
  datetimeFormats: Object.fromEntries(Object.keys(own).map((code) => [code, dateFormats])),
  missingWarn: false,
  fallbackWarn: false,
});
for (const [code, msgs] of Object.entries(own)) i18n.global.mergeLocaleMessage(code, msgs);

// The app's languages — the codes of its own catalogs — for the language picker.
export const LOCALE_CODES = Object.keys(own);
