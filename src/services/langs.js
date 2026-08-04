// SPDX-License-Identifier: MIT
// ONE way to name a language in this app. Home said "Spanish es", Review and Runs said
// "es", so the same row read as two different things depending on the page you were on
// — in a tool whose entire subject is languages. `Intl.DisplayNames` is the browser's
// own list (localised to the reader's UI language), and an unknown or private code
// falls back to the code itself rather than throwing.
const display = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" });
  } catch {
    return null; // very old webview — every helper below degrades to the raw code
  }
})();

/** "es" → "Spanish" (the code itself when it cannot be named). */
export function langName(code) {
  if (!code) return "";
  try {
    return display?.of(code) || code;
  } catch {
    return code;
  }
}

/** "es" → "Spanish (es)" — for pickers, where the code is the thing you type in config. */
export function langLabel(code) {
  const name = langName(code);
  return name === code ? code : `${name} (${code})`;
}

/** Picker options for a list of codes, optionally suffixed with an outstanding count. */
export function langOptions(codes, countFor = null) {
  return (codes || []).map((code) => {
    const n = countFor ? countFor(code) : 0;
    return { value: code, label: `${langLabel(code)}${n ? ` · ${n}` : ""}` };
  });
}
