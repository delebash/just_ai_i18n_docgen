// SPDX-License-Identifier: MIT
// What English each translation was made from — per language and key, the source text a
// translation was written for. Two jobs (2026-10-29, the user's "your rec on all … go"):
//
//   1. A changed English string is FOUND: a key whose recorded English differs from today's is a
//      `source-changed` finding (the reviewer sees the old English), so the dashboard's pending
//      run and Review pick it up. Before this record nothing noticed — the old translation stayed,
//      saying what the old English said.
//   2. The CLI's `translate` keeps every translation whose English hasn't changed. It used to keep
//      one only when the translation cache held its key — a key that included the project's
//      context and glossary — so a changed context sentence re-translated the whole catalogue and
//      wrote over every reviewed string (JustWrite's context changed 2026-10-17).
//
// A translation's English is recorded when it is written — Save, Apply, the CLI — and when a
// finding on it is accepted (the reviewer said it is right for today's English). A key that has a
// translation but no record yet (translated before the record existed, or edited outside docgen) is
// taken as current the first time it is seen: a change before then can't be known.
//
// The record lives where the translation cache did (`.just-ai-i18n-docgen-cache.json` beside the
// config — machine state, never committed: setup's .gitignore lines already name it); the old
// cache's {key-hash: translation} entries are dropped at the first write.

import { isDict, strip } from "@delebash/core/platform/py";
import { asMap, readJson, toPlain } from "./jsonio.js";
import { exists } from "./paths.js";
import { writeJsonAtomic } from "./state.js";

export const SOURCE_CHANGED = "source-changed";
const VERSION = 2;

/** `{lang: {key: english}}` from the file — an absent, old-shaped or corrupt file is an empty record
 *  (it costs the first-sight rule above, never a wrong answer). */
export function loadSources(file) {
  if (!exists(file)) return {};
  try {
    const d = toPlain(readJson(file));
    return isDict(d) && d.version === VERSION && isDict(d.sources) ? d.sources : {};
  } catch {
    return {};
  }
}

function save(file, sources) {
  writeJsonAtomic(file, { version: VERSION, sources });
}

/** Record `entries` (Map or object, key → English; null drops the key) for `lang`. */
export function recordSources(file, lang, entries) {
  const sources = loadSources(file);
  const forLang = isDict(sources[lang]) ? sources[lang] : {};
  for (const [key, english] of asMap(entries)) {
    if (english === null || english === undefined) delete forLang[key];
    else forLang[key] = english;
  }
  sources[lang] = forLang;
  save(file, sources);
}

const translated = (v) => typeof v === "string" && strip(v) !== "";

/** `lang`'s record with every translated key that has none yet taken as current (the first-sight
 *  rule); writes the file only when it added one. Returns `{key: english}`. */
export function seedSources(file, lang, sourceFlat, targetFlat) {
  const sources = loadSources(file);
  const forLang = isDict(sources[lang]) ? sources[lang] : {};
  const src = asMap(sourceFlat);
  let added = 0;
  for (const [key, value] of asMap(targetFlat)) {
    if (!translated(value) || Object.hasOwn(forLang, key) || !src.has(key)) continue;
    forLang[key] = src.get(key);
    added += 1;
  }
  if (added) {
    sources[lang] = forLang;
    save(file, sources);
  }
  return forLang;
}

/** The `source-changed` findings: a translated key whose recorded English isn't today's. The
 *  finding's detail is the English the translation was made from. */
export function sourceChangedFindings(record, sourceFlat, targetFlat) {
  const target = asMap(targetFlat);
  const out = [];
  for (const [key, english] of asMap(sourceFlat)) {
    if (!translated(target.get(key)) || !Object.hasOwn(record, key)) continue;
    if (record[key] !== english) out.push({ key, code: SOURCE_CHANGED, detail: record[key] });
  }
  return out;
}
