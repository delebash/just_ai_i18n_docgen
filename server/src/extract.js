// SPDX-License-Identifier: MIT
// Function 2 — author the help system ONCE, in the docs, and let it become locale keys. The
// port of extract.py (ported from just-ai-help's `server/extract.js`).
//
// The same sentence gets written three times — the help article, the surface's lede, a
// field's hint — and three copies drift, each into a different translation. The doc's
// front-matter is the single authoring home; this extracts `lede:`/`hints:` into
// `lede.<slug>` / `hints.<slug>.<name>` in the SOURCE locale — the same file the translator
// reads. docs → extract → en.json → translate → es.json; a changed hint re-translates as an
// ordinary key delta, and the translator never knows docs exist.
//
// OWNERSHIP, and why it is narrow. This tool OWNS the two generated prefixes and nothing
// else: on every run it removes every key under them and rewrites them from the docs, so a
// deleted hint disappears instead of lingering forever in nine languages. Every other key is
// untouched — a generator that can clobber hand-written copy is a generator nobody dares run.
//
// It runs at BUILD time. Runtime stays plain vue-i18n; nothing parses markdown in the app.

import path from "node:path";
import { FileNotFoundError, ValueError } from "@delebash/llm-runner/platform/py";
import { parseFrontMatter } from "./frontmatter.js";
import {
  AttributeError,
  cpCompare,
  dget,
  dumps,
  errText,
  isDict,
  pyStrip,
  pyTruthy,
  readJson,
  readText,
  typeName,
  writeText,
} from "./jsonio.js";
import { isAbsolutePy, isDir, listNames, removeSuffix, resolvePath } from "./paths.js";

/**
 * Locale files come in two shapes in the wild: genuinely nested objects and flat maps whose
 * keys contain literal dots. DETECTED, never configured — guessing wrong would restructure
 * the whole file, and a generator that reformats 800 hand-written keys to add two of its own
 * is not one anyone runs twice.
 */
const isFlat = (raw) => [...raw.keys()].some((k) => k.includes("."));

function setKey(obj, keyPath, value, flat) {
  if (flat) {
    obj.set(keyPath, value);
    return;
  }
  const parts = keyPath.split(".");
  let node = obj;
  for (const p of parts.slice(0, -1)) {
    if (!(node.get(p) instanceof Map)) node.set(p, new Map());
    node = node.get(p);
  }
  node.set(parts[parts.length - 1], value);
}

function countLeaves(o) {
  if (isDict(o)) {
    let n = 0;
    for (const v of o instanceof Map ? o.values() : Object.values(o)) n += countLeaves(v);
    return n;
  }
  return 1;
}

/** Every existing key under `prefix`, removed. Returns how many went. */
function clearPrefix(obj, prefix, flat) {
  if (flat) {
    const doomed = [...obj.keys()].filter((k) => k === prefix || k.startsWith(`${prefix}.`));
    for (const k of doomed) obj.delete(k);
    return doomed.length;
  }
  if (!obj.has(prefix)) return 0;
  const n = countLeaves(obj.get(prefix));
  obj.delete(prefix);
  return n;
}

/** `sorted(paths)` — pathlib compares Windows paths case-insensitively. */
const pathSortKey = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * Reads every doc, regenerates the owned prefixes, writes (or under `check`, verifies without
 * writing — the pre-ship contract: not "are the docs valid" but "does the committed locale
 * match the docs"; a stale generated key is exactly as broken as a missing one, and neither is
 * visible by reading either file alone).
 *
 * Returns {keys, removed, changed, stale}.
 */
export function runExtract(project, { check = false, log = console.log } = {}) {
  const cfg = project.cfg;
  const docsRel = String(dget(cfg, "docsDir", "docs"));
  const docsDir = resolvePath(isAbsolutePy(docsRel) ? docsRel : path.join(project.paths.configDir, docsRel));
  const ledePrefix = dget(cfg, "ledePrefix", "lede");
  const hintsPrefix = dget(cfg, "hintsPrefix", "hints");

  if (!isDir(docsDir)) throw new FileNotFoundError(`No docs directory at ${docsDir} — set "docsDir" in your config.`);

  const raw = readJson(project.paths.sourceFile);
  if (!(raw instanceof Map)) throw new AttributeError(`'${typeName(raw)}' object has no attribute 'get'`);
  const flat = isFlat(raw);

  const files = listNames(docsDir)
    .filter((n) => n.endsWith(".md"))
    .map((n) => path.join(docsDir, n))
    .sort((a, b) => cpCompare(pathSortKey(a), pathSortKey(b)));
  const generated = new Map();
  let docsWithFm = 0;

  for (const f of files) {
    const name = path.basename(f);
    const slug = removeSuffix(name, ".md");
    let data;
    try {
      [data] = parseFrontMatter(readText(f));
    } catch (err) {
      // Loud, and NAMES the file: a doc whose front-matter does not parse must not be skipped
      // silently, or its copy vanishes with nothing to notice.
      if (err instanceof ValueError) throw new ValueError(`${name}: ${errText(err)}`, { cause: err });
      throw err;
    }
    if (!pyTruthy(data)) continue;
    docsWithFm += 1;

    const lede = data.get("lede");
    if (typeof lede === "string" && pyStrip(lede)) generated.set(`${ledePrefix}.${slug}`, pyStrip(lede));
    const hints = data.get("hints");
    if (hints instanceof Map) {
      for (const [hname, text] of hints) {
        if (typeof text === "string" && pyStrip(text)) generated.set(`${hintsPrefix}.${slug}.${hname}`, pyStrip(text));
      }
    }
  }

  const before = dumps(raw, { sortKeys: true });
  const removed = clearPrefix(raw, ledePrefix, flat) + clearPrefix(raw, hintsPrefix, flat);
  for (const [k, v] of generated) setKey(raw, k, v, flat);
  const changed = dumps(raw, { sortKeys: true }) !== before;

  const nLede = [...generated.keys()].filter((k) => k.startsWith(`${ledePrefix}.`)).length;
  const nHints = [...generated.keys()].filter((k) => k.startsWith(`${hintsPrefix}.`)).length;
  log(
    `${files.length} doc(s), ${docsWithFm} with front-matter → ${generated.size} key(s)` +
      ` (${nLede} lede, ${nHints} hints), ${removed} replaced`,
  );

  let stale = false;
  if (check) {
    if (changed) {
      stale = true;
      log(`STALE: ${project.paths.sourceFile} does not match ${docsDir}. Run: just-ai-i18n-docgen extract ${project.configPath}`);
    } else log("up to date");
  } else if (changed) {
    writeText(project.paths.sourceFile, `${dumps(raw, { indent: 2, ensureAscii: false })}\n`);
    log(`wrote ${project.paths.sourceFile}`);
  } else log("no change");

  return { keys: generated.size, removed, changed, stale };
}
