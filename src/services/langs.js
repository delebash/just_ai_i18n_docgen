// SPDX-License-Identifier: MIT
// ONE way to name a language in this app. Home said "Spanish es", Review and Runs said
// "es", so the same row read as two different things depending on the page you were on
// — in a tool whose entire subject is languages. `Intl.DisplayNames` is the browser's
// own list, and an unknown or private code falls back to the code itself rather than
// throwing. The names are in the INTERFACE's language (vue-i18n's locale), not the
// window's: with Spanish chosen, Home, Review and Runs said "Spanish (es)" (2026-10-17).
import { i18n } from "../i18n/index.js";

const displays = new Map(); // one Intl.DisplayNames per interface language

/** The interface's language — read inside each helper, so a computed that names a language
 * runs again when the language is switched. */
const uiLocale = () => i18n.global.locale.value;

function display(locale) {
  if (!displays.has(locale)) {
    let d = null;
    try {
      d = new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      // very old webview — every helper below degrades to the raw code
    }
    displays.set(locale, d);
  }
  return displays.get(locale);
}

/** "es" → "Spanish" as it reads inside a sentence ("español" in Spanish); the code itself when
 * it cannot be named. */
export function langName(code) {
  if (!code) return "";
  try {
    return display(uiLocale())?.of(code) || code;
  } catch {
    return code;
  }
}

/** The name standing on its own — a row, a picker option: first letter capitalised, as CLDR's
 * stand-alone and menu contexts ask for Spanish ("Español"). English names are unchanged. */
export function langTitle(code) {
  const name = langName(code);
  if (name === code) return code;
  return name.charAt(0).toLocaleUpperCase(uiLocale()) + name.slice(1);
}

/** "es" → "Spanish (es)" — for pickers, where the code is the thing you type in config. */
export function langLabel(code) {
  const name = langTitle(code);
  return name === code ? code : `${name} (${code})`;
}

/** Picker options for a list of codes, optionally suffixed with an outstanding count. */
export function langOptions(codes, countFor = null) {
  return (codes || []).map((code) => {
    const n = countFor ? countFor(code) : 0;
    return { value: code, label: `${langLabel(code)}${n ? ` · ${n}` : ""}` };
  });
}
