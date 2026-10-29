// SPDX-License-Identifier: MIT
// The named date formats (i18n/index.js): every language lists them, so a date reads in the interface's
// language and in this computer's time zone — Runs and Home showed the stored UTC string, sliced.
import { expect, test } from "vitest";
import { i18n, LOCALE_CODES } from "./index.js";

const when = new Date("2026-10-29T02:42:52.051Z");

test("every language has the named formats, written as Intl writes that language", () => {
  for (const code of LOCALE_CODES) {
    i18n.global.locale.value = code;
    const want = new Intl.DateTimeFormat(code, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(when);
    expect(i18n.global.d(when, "dateTime")).toBe(want);
    expect(i18n.global.d(when, "dateTimeShort")).not.toContain(":52");
  }
  i18n.global.locale.value = "en";
});
