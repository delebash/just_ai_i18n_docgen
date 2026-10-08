// SPDX-License-Identifier: MIT
// Locale-file walking — shared because two copies drift. The port of jsonio.py
// (ported from just-ai-help's `server/jsonutil.js`). The translate loop, the checks and the
// review surface all walk a locale file the same way: if they disagree about what a key path
// is or what counts as a placeholder, the checks stop describing what the loop wrote and the
// review page stops addressing the keys the checks named.
//
// Python's text semantics come from the kit (platform/py.js and platform/pyjson.js, one copy
// for the family): `jsonLoadsExact` is `json.loads` value for value — objects come back as
// `Map`s, because a JS object moves integer-like keys ("404", "10") to the front and a rebuilt
// locale file must keep the source's key order (build sheet rule 7); floats come back as
// `PyFloat` and unsafe integers as BigInt; errors carry Python's words and positions
// ("Expecting value: line 1 column 1 (char 0)" — a setup screen shows them) — and `pyJson` is
// `json.dumps` over those values (Maps included; sort_keys in code-point order). Its strip,
// `\s` / `\d` classes, code-point lengths and dict helpers are the kit's too. What stays
// here is docgen's own:
//   - `readText` / `writeText` are pathlib's: universal newlines on read, `os.linesep` on
//     write (Python writes CRLF files on Windows — measured, Python 3.12);
//   - Python's `str()`/`repr()` of a leaf (`pyStr`, `pyRepr`, `reprStr`), which escape every
//     non-printable character as CPython does (the kit's `strRepr` escapes the control
//     characters only — converging them is open);
//   - the dict helpers over a Map or a plain object (`dhas`, `dentries`, `asMap`,
//     `mergeDicts`), the `\w`-derived classes and the locale walk.

import { readFileSync, writeFileSync } from "node:fs";
import { jsonLoadsExact, PyFloat, pyFloat } from "@delebash/llm-runner/platform/pyjson";
import {
  AttributeError,
  cpLen,
  FileNotFoundError,
  IndexError,
  isDict,
  KeyError,
  PY_WS,
  pyGet,
  pyTypeName,
  reEscape,
} from "@delebash/llm-runner/platform/py";

const IS_WIN = process.platform === "win32";

// ── Python's exception kinds the port raises by name ─────────────────────────
/** An OSError that isn't "file not found" (PermissionError, IsADirectoryError…). */
export class OSError extends Error {
  constructor(message, errno = null) {
    super(message);
    this.name = "OSError";
    this.errno = errno;
  }
}
export class FileExistsError extends OSError {
  constructor(message) {
    super(message, 17);
    this.name = "FileExistsError";
  }
}

// ── Python's character classes (for patterns built with the `u` flag) ────────
/** `[^\W_]` — `\w` minus the underscore: letters and every number category. */
export const ALNUM = "[\\p{L}\\p{N}]";
/** `[^\W\d_]` — `\w` minus digits and underscore: letters plus the non-decimal numbers
 * (Nl, No — "Ⅷ", "¼"; measured). */
export const LETTER = "[\\p{L}\\p{Nl}\\p{No}]";

/** `str.isspace()` for one character. */
export const isSpace = (ch) => ch !== "" && PY_WS.includes(ch);

/** `str.count(sub)` (non-overlapping; an empty `sub` counts len+1, as Python). */
export function pyCount(s, sub) {
  if (sub === "") return cpLen(s) + 1;
  return s.split(sub).length - 1;
}

// ── dicts: a JSON object is a Map here (key order), a plain object elsewhere ──
// (`isinstance(v, dict)`, `d.get`, `for x in v`, `bool(v)` and the type names are the kit's.)
const isPlainDict = (v) => isDict(v) && !(v instanceof Map);
/** `k in d` */
export const dhas = (d, k) => (d instanceof Map ? d.has(k) : isPlainDict(d) ? Object.hasOwn(d, k) : false);
/** `d.items()` */
export const dentries = (d) => (d instanceof Map ? [...d.entries()] : isPlainDict(d) ? Object.entries(d) : []);
/** A Map view of a dict (a plain object's own order — no integer-like keys in literals). */
export function asMap(d) {
  if (d instanceof Map) return d;
  if (d == null) return new Map();
  if (isPlainDict(d)) return new Map(Object.entries(d));
  throw new AttributeError(`'${pyTypeName(d)}' object has no attribute 'items'`);
}
/** `{**a, **b}` — a's keys in a's order, b's values win, b's new keys appended. */
export function mergeDicts(a, b) {
  const out = new Map(asMap(a));
  for (const [k, v] of dentries(b)) out.set(k, v);
  return out;
}

/** `seq[0]` that raises as Python does on an empty list. */
export function firstOf(seq) {
  if (!seq || seq.length === 0) throw new IndexError("list index out of range");
  return seq[0];
}

// ── str() and repr() ──────────────────────────────────────────────────────────
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** `repr(s)` of a str. */
export function reprStr(s) {
  s = String(s);
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += `\\${q}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch !== " " && NON_PRINTABLE.test(ch)) {
      if (c < 0x100) out += `\\x${c.toString(16).padStart(2, "0")}`;
      else if (c < 0x10000) out += `\\u${c.toString(16).padStart(4, "0")}`;
      else out += `\\U${c.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return out + q;
}

function numStr(v) {
  if (v instanceof PyFloat) return floatStr(v.v);
  if (typeof v === "bigint") return v.toString();
  if (Number.isInteger(v)) return String(v);
  return floatStr(v);
}
function floatStr(x) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  return pyFloat(x);
}

/** `repr(v)` for JSON-shaped values. */
export function pyRepr(v) {
  if (typeof v === "string") return reprStr(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (isDict(v)) return `{${dentries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(", ")}}`;
  return pyStr(v);
}

/** `str(v)` for JSON-shaped values (a leaf flatten stringifies, an f-string slot). */
export function pyStr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || v instanceof PyFloat) return numStr(v);
  return pyRepr(v);
}

// ── text files, as pathlib reads and writes them ─────────────────────────────
function osErrorFor(e, p) {
  const where = reprStr(String(p));
  if (e?.code === "ENOENT") return new FileNotFoundError(`[Errno 2] No such file or directory: ${where}`);
  if (e?.code === "EACCES" || e?.code === "EPERM" || (IS_WIN && e?.code === "EISDIR")) {
    return new OSError(`[Errno 13] Permission denied: ${where}`, 13);
  }
  if (e?.code === "EISDIR") return new OSError(`[Errno 21] Is a directory: ${where}`, 21);
  return e;
}

/** `Path(p).read_text(encoding="utf-8")` — universal newlines ("\r\n" and "\r" read as "\n"). */
export function readText(p) {
  let text;
  try {
    text = readFileSync(String(p), "utf8");
  } catch (e) {
    throw osErrorFor(e, p);
  }
  return text.replace(/\r\n?/g, "\n");
}

/** `Path(p).write_text(s, encoding="utf-8")` — "\n" written as the OS line separator. */
export function writeText(p, s) {
  try {
    writeFileSync(String(p), IS_WIN ? s.replace(/\n/g, "\r\n") : s, "utf8");
  } catch (e) {
    throw osErrorFor(e, p);
  }
}

/** A `jsonLoadsExact` result as plain JavaScript: Maps → objects, PyFloat → number, BigInt →
 * number (for values the code reads, not re-writes — a config, the workshop state). */
export function toPlain(v) {
  if (v instanceof Map) {
    const out = {};
    for (const [k, x] of v) {
      // A "__proto__" key is data, never the prototype.
      if (k === "__proto__") Object.defineProperty(out, k, { value: toPlain(x), enumerable: true, writable: true, configurable: true });
      else out[k] = toPlain(x);
    }
    return out;
  }
  if (Array.isArray(v)) return v.map(toPlain);
  if (v instanceof PyFloat) return v.v;
  if (typeof v === "bigint") return Number(v);
  return v;
}

/** `json.loads(Path(p).read_text())` */
export const readJson = (p) => jsonLoadsExact(readText(p));

// ── the locale walk (jsonio.py) ──────────────────────────────────────────────

/**
 * Flattens a nested locale object into {"a.b.c": "text"} (a Map, in file order). Non-dict
 * leaves are stringified (locale files hold strings; anything else is someone's bug
 * surfaced, not hidden).
 */
export function flatten(obj, prefix = "", out = new Map()) {
  if (!isDict(obj)) throw new AttributeError(`'${pyTypeName(obj)}' object has no attribute 'items'`);
  for (const [k, v] of dentries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isDict(v)) flatten(v, path, out);
    else out.set(path, pyStr(v));
  }
  return out;
}

/**
 * Rebuilds a nested object with the SOURCE's shape and key order, each leaf taken from
 * `values` (a flat map). Leaves missing from `values` are DROPPED, so a key that failed to
 * translate is absent rather than silently English — the checks then report it as
 * `missing`, which is the point of never faking success.
 */
export function rebuild(source, values, prefix = "") {
  const out = new Map();
  for (const [k, v] of dentries(source)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isDict(v)) {
      const child = rebuild(v, values, path);
      if (child.size) out.set(k, child);
    } else if (dhas(values, path)) out.set(k, pyGet(values, path));
  }
  return out;
}

/**
 * The interpolation matcher, built from the config's placeholder syntax
 * ({"prefix": "{", "suffix": "}"} and friends). Non-greedy across newlines, exactly like
 * the JS original's `[\s\S]*?`. Global: use it with matchAll / replace.
 */
export function placeholderRe(placeholder) {
  for (const k of ["prefix", "suffix"]) if (!dhas(placeholder, k)) throw new KeyError(reprStr(k));
  return new RegExp(`${reEscape(pyGet(placeholder, "prefix"))}.*?${reEscape(pyGet(placeholder, "suffix"))}`, "gsu");
}

/** `pattern.findall(s)` for a group-less pattern. */
export const findAll = (re, s) => [...String(s).matchAll(re)].map((m) => m[0]);
