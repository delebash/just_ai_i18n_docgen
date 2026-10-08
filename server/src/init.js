// SPDX-License-Identifier: MIT
// Deriving a project's config from ITS en.json — the code behind the setup tab. The port of
// init.py (ported from just-ai-help's `server/init.js`).
//
// One derivation for the path box's live validation AND the save, so a config cannot depend
// on which door you came through. A generator, not a template: it can LOOK at your strings —
// the source file gives the locale folder and the source language, the folder gives the
// targets, the strings give glossary candidates. `context` is the one thing only you know.
//
// ONE DELIBERATE CHANGE from the Node version: there is NO `engine` field. Which engine a
// feature runs is an ENGINE PRESET in the shared stack's DB (one-source), assigned on the
// AI-features page, not a per-project config value.
//
// Placeholder syntax and plural separator are REPORTED, never written — they are read from
// en.json on every run, and seeing them proves the tool understood your catalogue before an
// hour of engine time proves it did not.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { cmp, FileNotFoundError, pySorted, ValueError } from "@delebash/llm-runner/platform/py";
import { inferPlaceholder, inferPluralSeparator } from "./infer.js";
import { dumps, FileExistsError, flatten, LETTER, pyStrip, readJson, S, writeText } from "./jsonio.js";
import { exists, isDir, listNames, removeSuffix, resolvePath } from "./paths.js";

export const CONFIG_DIR = "just-ai-i18n-docgen";
export const CONFIG_NAME = "config.json";

// Python's `$` (no MULTILINE) also matches before a final "\n".
const LOCALE_FILE = /^([a-z]{2}(?:-[A-Za-z]{2,4})?)\.json\n?$/;

/**
 * The nearest ancestor holding a package.json — what every JS tool does, and the difference
 * between the config landing somewhere visible and it landing five directories deep beside
 * the strings. null for a non-JS project; the caller then requires an explicit out dir
 * rather than guessing.
 */
export function findProjectRoot(startDir, marker = "package.json") {
  let d = resolvePath(startDir);
  for (;;) {
    if (exists(path.join(d, marker))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** Locale files in a folder: `<code>.json`, never a tooling sidecar like `es.accepted.json`. */
export function localeCodesIn(dir) {
  if (!isDir(dir)) return [];
  const out = [];
  for (const name of listNames(dir)) {
    const m = LOCALE_FILE.exec(name);
    if (m) out.push(m[1]);
  }
  return pySorted(out);
}

// An inner dot or plus is part of the word — `llama.cpp`, `C++`, `Vue3` — but a TRAILING one
// is sentence punctuation, so "Studio." and "Studio" count as one thing.
const W_CLASS = "[\\p{L}\\p{N}_]";
const WORD = new RegExp(`${LETTER}${W_CLASS}*(?:[.+-]${W_CLASS}+)*`, "gu");
const SENTENCE_SPLIT = new RegExp(`(?<=[.!?:])${S}+|\\n`, "u");
const IS_UPPER = /^\p{Uppercase}/u; // str.isupper() of the first character

/**
 * Terms worth PROPOSING for the glossary: capitalised words that recur and are never merely a
 * sentence opener. Suggestions only — the glossary is the most dangerous field in the config:
 * every term is also a blanket instruction, and on a real 1,965-key catalogue adding `AI`
 * turned 48 CORRECT translations into findings. A machine cannot tell a brand from a word
 * that starts a sentence; it proposes, a human decides.
 */
export function glossaryCandidates(values, { minCount = 3, limit = 12 } = {}) {
  const counts = new Map();
  const midSentence = new Set();
  for (const v of values) {
    for (const chunk of String(v).split(SENTENCE_SPLIT)) {
      const words = [...chunk.matchAll(WORD)].map((m) => m[0]).filter((w) => IS_UPPER.test(w));
      const stripped = pyStrip(chunk);
      const first = words.length && stripped.startsWith(words[0]) ? words[0] : null;
      words.forEach((w, i) => {
        counts.set(w, (counts.get(w) ?? 0) + 1);
        // Capitalised anywhere but the opening position means it is capitalised because of
        // WHAT IT IS, not because a sentence started.
        if (i > 0 || w !== first) midSentence.add(w);
      });
    }
  }
  const ranked = [...counts].filter(([w, n]) => n >= minCount && midSentence.has(w) && [...w].length > 1);
  ranked.sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  return ranked.slice(0, limit).map(([w]) => w);
}

/** `os.path.relpath(target, start)` — on Windows a different drive raises, as ntpath does. */
function relpath(target, start) {
  if (process.platform === "win32") {
    const a = path.parse(path.resolve(target)).root.replace(/[\\/]+$/, "");
    const b = path.parse(path.resolve(start)).root.replace(/[\\/]+$/, "");
    if (a.toLowerCase() !== b.toLowerCase()) throw new ValueError(`path is on mount '${a}', start on mount '${b}'`);
  }
  return path.relative(start, target) || ".";
}

/** Everything derivable from one en.json, with nothing written to disk. */
export function planInit(sourcePath, { out = null, targets = null, context = null, glossary = null } = {}) {
  const sourceFile = resolvePath(sourcePath);
  if (!exists(sourceFile)) throw new FileNotFoundError(`no such file: ${sourceFile}`);

  const localesDir = path.dirname(sourceFile);
  const sourceLanguage = removeSuffix(path.basename(sourceFile), ".json");
  const flat = flatten(readJson(sourceFile));
  const values = [...flat.values()].filter((v) => typeof v === "string");
  if (!values.length) throw new ValueError(`${sourceFile} holds no strings`);

  const existing = localeCodesIn(localesDir).filter((c) => c !== sourceLanguage);
  const root = out ? resolvePath(out) : findProjectRoot(localesDir);
  if (root === null) {
    throw new ValueError(`no package.json above ${localesDir} — pass an output dir to say where the config should go`);
  }

  const configDir = path.join(root, CONFIG_DIR);
  const configPath = path.join(configDir, CONFIG_NAME);
  // The SOURCE FILE, relative to the config — its folder is the locale folder and its name
  // the source language, so no second field can disagree. Forward slashes read the same on
  // every platform.
  const sourceRel = relpath(sourceFile, configDir).split(path.sep).join("/");

  const cfg = {
    source: sourceRel,
    targets: targets !== null ? targets : existing,
    context: context !== null ? context : "",
    glossary: glossary !== null ? glossary : [],
  };

  return {
    cfg,
    configPath,
    configDir,
    root,
    localesDir,
    sourceLanguage,
    keyCount: flat.size,
    sourceFlat: flat,
    existingTargets: existing,
    placeholder: inferPlaceholder(values),
    pluralSeparator: inferPluralSeparator(values),
    candidates: glossaryCandidates(values),
  };
}

/** Writes the config, refusing to clobber one that is already there. `plan.cfg` may be a Map
 * (a merge that kept an existing config's own order). */
export function writeInit(plan, { force = false } = {}) {
  const configPath = plan.configPath;
  if (exists(configPath) && !force) throw new FileExistsError(`${configPath} already exists — pass force to overwrite it`);
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeText(configPath, `${dumps(plan.cfg, { indent: 2, ensureAscii: false })}\n`);
  return String(configPath);
}

/**
 * The lines a host app should add to .gitignore. Reported, never written — it is their file.
 * Committed alongside: config.json, <lang>.accepted.json, <lang>.notes.json — those are your
 * work and travel with the repo.
 */
export function gitignoreLines() {
  return [
    `${CONFIG_DIR}/*.probe.json`,
    `${CONFIG_DIR}/.just-ai-i18n-docgen-cache.json`,
    `${CONFIG_DIR}/.just-ai-i18n-docgen-probe-cache.json`,
    `${CONFIG_DIR}/.just-ai-i18n-docgen-state.json`,
  ];
}
