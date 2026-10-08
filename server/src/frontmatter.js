// SPDX-License-Identifier: MIT
// Front-matter parsing for the docs extractor — a deliberately SMALL subset of YAML. The port
// of frontmatter.py (ported from just-ai-help's `server/frontmatter.js`), hand-rolled on
// purpose: a YAML library would ACCEPT the exact constructs this parser must refuse. The
// danger with any front-matter parser is not that it fails — it is that it SUCCEEDS on
// something it does not understand and silently drops text, and the text it would drop here
// is user-facing copy that then never reaches a locale file, never gets translated, and
// ships as a blank hint.
//
// So the rule is: support a narrow, documented subset, and RAISE on anything else. A loud
// failure at build time is cheap; a hint that quietly went missing is not.
//
// Supported:
//
//     ---
//     lede: One sentence describing the surface.
//     hints:
//       fieldName: What this field is for.
//       other: "Quoted when it contains: a colon."
//     ---
//     # The document body, untouched.
//
// Not supported, and each raises: tabs for indentation, YAML lists, multi-line scalars
// (| and >), nesting deeper than one level, duplicate keys.
//
// The data is a Map (key order as written); the patterns use Python's `\s`/`\d` and its
// MULTILINE `^`/`$` (only "\n" ends a line — JS's `m` flag also breaks on "\r").

import { ValueError } from "@delebash/llm-runner/platform/py";
import { D, pyLstrip, pyStrip, S } from "./jsonio.js";

const FENCE = /^---[ \t]*\r?\n/;
const CLOSE = /(?:^|(?<=\n))---[ \t]*(?=\n|$)/; // re.MULTILINE `^---[ \t]*$`
const LIST_ITEM = new RegExp(`^${S}*-${S}`, "u");
const BLOCK_SCALAR = new RegExp(`^[|>][-+]?${D}*$`, "u"); // fullmatch

function unquote(v) {
  const s = pyStrip(v);
  const cps = Array.from(s);
  if (cps.length >= 2 && cps[0] === cps[cps.length - 1] && (cps[0] === '"' || cps[0] === "'")) {
    return cps.slice(1, -1).join("");
  }
  return s;
}

function fail(line, n, why) {
  throw new ValueError(`front-matter line ${n}: ${why}\n  ${line}`);
}

/**
 * Splits `text` into [data, body]. A file with no front-matter fence returns [{}, text] —
 * not an error; most docs will not have one yet. `data` is a Map; a `hints:` block is a
 * nested Map.
 */
export function parseFrontMatter(text) {
  if (!FENCE.test(text)) return [new Map(), text];

  const afterOpen = text.replace(FENCE, "");
  const close = CLOSE.exec(afterOpen);
  if (close === null) throw new ValueError("front-matter: opening --- has no closing ---");

  const block = afterOpen.slice(0, close.index);
  const body = afterOpen.slice(close.index).replace(/^---[ \t]*\r?\n?/, "");

  const data = new Map();
  let parent = null;

  block.split("\n").forEach((line, i) => {
    let raw = line;
    while (raw.endsWith("\r")) raw = raw.slice(0, -1); // rstrip("\r")
    const n = i + 2; // +1 for the opening fence, +1 for 1-based
    if (!pyStrip(raw) || pyStrip(raw).startsWith("#")) return;
    if (raw.includes("\t")) fail(raw, n, "tabs are not allowed — use spaces");
    if (LIST_ITEM.test(raw)) fail(raw, n, "lists are not supported");

    const indent = raw.length - pyLstrip(raw).length;
    const colon = raw.indexOf(":");
    if (colon === -1) fail(raw, n, "expected `key: value`");

    const key = pyStrip(raw.slice(0, colon));
    const value = raw.slice(colon + 1);
    if (!key) fail(raw, n, "empty key");
    // The block-scalar indicator is the VALUE, not the line's first character — `lede: |`
    // opens a multi-line string. Testing the line start missed it and the parser then
    // blamed an orphan indent one line later, naming the wrong problem.
    if (BLOCK_SCALAR.test(pyStrip(value))) fail(raw, n, "multi-line scalars (| and >) are not supported");

    if (indent === 0) {
      if (data.has(key)) fail(raw, n, `duplicate key "${key}"`);
      if (pyStrip(value) === "") {
        data.set(key, new Map());
        parent = key;
      } else {
        data.set(key, unquote(value));
        parent = null;
      }
      return;
    }

    // Indented: must belong to a map opened on a previous line.
    if (parent === null) fail(raw, n, "indented line with no parent key above it");
    if (pyStrip(value) === "") fail(raw, n, "nesting deeper than one level is not supported");
    if (data.get(parent).has(key)) fail(raw, n, `duplicate key "${parent}.${key}"`);
    data.get(parent).set(key, unquote(value));
  });

  return [data, body];
}
