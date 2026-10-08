// SPDX-License-Identifier: MIT
// Where everything lives — the port of paths.py. ONE module, because path resolution was the
// single largest source of confusion in the Node tool and it was spread across four files
// that disagreed.
//
// THE RULE: every path resolves against the CONFIG FILE'S OWN DIRECTORY, never against the
// working directory. What that fixes, measured rather than guessed: `localesDir` used to
// resolve against wherever you typed the command, and the cache resolved the same way — run
// from the wrong folder and the tool silently started with NO cache and re-translated the
// whole catalogue, which cost 27 minutes and 464 hand-corrected keys on 2026-07-31.
//
// THE LAYOUT this enables — the tool's whole footprint in a host app is one visible folder:
//
//     <app>/just-ai-i18n-docgen/           <- next to package.json, obvious to a newcomer
//       config.json                 <- the four fields
//       es.accepted.json            <- reviewer verdicts       (committed)
//       es.notes.json               <- per-key knowledge       (committed)
//       es.probe.json               <- second-pass measurement (not committed)
//       .just-ai-i18n-docgen-cache.json             <- disposable              (not committed)
//
// Engine connections and API keys are NOT here — they live in the shared LLM stack's DB.
//
// Keeping review files out of `locales/` is not tidiness: that folder is loaded by the host
// app, and the fix for "adding a language needs three code edits" is to glob it — a plain
// *.json glob over the old layout registers a phantom language called "es.accepted".
//
// Paths are strings in the form Python's `str(Path(...))` gives (native separators).

import { readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { purePath } from "@delebash/llm-runner/platform/data_paths";
import { pyGet, ValueError } from "@delebash/llm-runner/platform/py";
import { pyStr } from "./jsonio.js";

export const CACHE_FILE = ".just-ai-i18n-docgen-cache.json";

// Python's `$` (no MULTILINE) also matches before a final "\n".
const SIDECAR_RE = /\.(accepted|notes|probe)\.json\n?$/;

/** `Path(p).resolve()` (strict=False): absolute, symlinks resolved as far as the path
 * exists, the missing tail kept as given. Candidate for platform/ (data_paths has one). */
export function resolvePath(p) {
  let head = path.resolve(String(p));
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync.native(head);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const up = path.dirname(head);
      if (up === head) return path.resolve(String(p));
      tail.push(path.basename(head));
      head = up;
    }
  }
}

/** `Path(p).is_absolute()` — on Windows a drive AND a root (or a UNC share). */
export function isAbsolutePy(p) {
  const s = String(p);
  if (process.platform !== "win32") return s.startsWith("/");
  return /^[A-Za-z]:[\\/]/.test(s) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(s);
}

export const exists = (p) => {
  try {
    statSync(String(p));
    return true;
  } catch {
    return false;
  }
};
export const isDir = (p) => {
  try {
    return statSync(String(p)).isDirectory();
  } catch {
    return false;
  }
};
export const isFile = (p) => {
  try {
    return statSync(String(p)).isFile();
  } catch {
    return false;
  }
};
/** `[f.name for f in Path(d).iterdir()]` */
export const listNames = (d) => readdirSync(String(d));

/** `str.removesuffix(sfx)` */
export const removeSuffix = (s, sfx) => (sfx && s.endsWith(sfx) ? s.slice(0, -sfx.length) : s);

export class ProjectPaths {
  constructor({ configDir, localesDir, sourceLanguage, sourceFile, sidecarDir, cachePath }) {
    this.configDir = configDir;
    this.localesDir = localesDir;
    this.sourceLanguage = sourceLanguage;
    this.sourceFile = sourceFile;
    this.sidecarDir = sidecarDir;
    this.cachePath = cachePath;
    Object.freeze(this);
  }

  targetFile(lang) {
    return path.join(this.localesDir, `${lang}.json`);
  }

  acceptedFile(lang) {
    return path.join(this.sidecarDir, `${lang}.accepted.json`);
  }

  notesFile(lang) {
    return path.join(this.sidecarDir, `${lang}.notes.json`);
  }

  probeFile(lang) {
    return path.join(this.sidecarDir, `${lang}.probe.json`);
  }
}

/**
 * Everything derived from one config file path.
 *
 * `source` names the source FILE ("../src/i18n/locales/en.json"). Its folder is the locale
 * folder and its basename is the source language, so that single field replaces the folder
 * + sourceLanguage pair — nothing has to agree with anything else, because there is only one
 * fact. Older folder-shaped configs (`locales`/`localesDir` + `sourceLanguage`) are still
 * read, so upgrading invalidates nothing.
 */
export function projectPaths(configPath, cfg) {
  const configDir = path.dirname(resolvePath(configPath));
  let sourceFile;
  let localesDir;
  let sourceLanguage;

  const source = pyGet(cfg, "source");
  if (source) {
    const src = pyStr(source);
    sourceFile = isAbsolutePy(src) ? purePath(src) : resolvePath(path.join(configDir, src));
    localesDir = path.dirname(sourceFile);
    sourceLanguage = removeSuffix(path.basename(sourceFile), ".json");
  } else {
    const rel = pyGet(cfg, "locales") || pyGet(cfg, "localesDir");
    if (!rel) throw new ValueError(`config at ${configPath} has no "source" — it must name your en.json`);
    const relP = pyStr(rel);
    localesDir = isAbsolutePy(relP) ? purePath(relP) : resolvePath(path.join(configDir, relP));
    sourceLanguage = pyStr(pyGet(cfg, "sourceLanguage", "en"));
    sourceFile = path.join(localesDir, `${sourceLanguage}.json`);
  }

  // Review artefacts sit beside the config. If a project already keeps them in the locales
  // dir — where every version before 2026-07-31 put them — that location wins, so upgrading
  // never orphans a reviewer's verdicts. The choice is made ONCE for the whole project, never
  // per file: deciding per file split a real catalogue across two folders, and "where are my
  // review files" must have one answer.
  const legacyInUse =
    !samePath(localesDir, configDir) && isDir(localesDir) && listNames(localesDir).some((n) => SIDECAR_RE.test(n));
  const sidecarDir = legacyInUse ? localesDir : configDir;

  return new ProjectPaths({
    configDir,
    localesDir,
    sourceLanguage,
    sourceFile,
    sidecarDir,
    cachePath: path.join(configDir, CACHE_FILE),
  });
}

/** `Path(a) == Path(b)` (case-insensitive on Windows). */
export function samePath(a, b) {
  const n = (s) => path.normalize(String(s));
  return process.platform === "win32" ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}
