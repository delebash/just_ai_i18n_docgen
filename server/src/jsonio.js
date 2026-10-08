// SPDX-License-Identifier: MIT
// Locale-file walking — shared because two copies drift. The port of jsonio.py
// (ported from just-ai-help's `server/jsonutil.js`). The translate loop, the checks and the
// review surface all walk a locale file the same way: if they disagree about what a key path
// is or what counts as a placeholder, the checks stop describing what the loop wrote and the
// review page stops addressing the keys the checks named.
//
// Beside the walk, this module carries the Python text semantics every docgen module shares
// (each a candidate for platform/):
//   - `loads` is `json.loads`, value for value: objects come back as `Map`s, because a JS
//     object moves integer-like keys ("404", "10") to the front and a rebuilt locale file
//     must keep the source's key order (build sheet rule 7); floats come back as `PyFloat`
//     and unsafe integers as BigInt, so `str()` of a leaf and a re-written file say what
//     Python says; errors carry Python's words and positions ("Expecting value: line 1
//     column 1 (char 0)" — a setup screen shows them);
//   - `dumps` is `json.dumps` over those values (Maps included; sort_keys in code-point
//     order);
//   - `readText` / `writeText` are pathlib's: universal newlines on read, `os.linesep` on
//     write (Python writes CRLF files on Windows — measured, Python 3.12);
//   - Python's `str()`/`repr()`, its whitespace (`str.strip()` and `\s` include U+001C–U+001F
//     and U+0085, not U+FEFF), its Unicode `\d` / `\w` classes and code-point lengths.

import { readFileSync, writeFileSync } from "node:fs";
import { PyFloat, pyFloat } from "@delebash/llm-runner/platform/pyjson";
import { FileNotFoundError, KeyError, ValueError } from "@delebash/llm-runner/platform/py";

const IS_WIN = process.platform === "win32";

// ── Python's exception kinds the port raises by name ─────────────────────────
export class AttributeError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttributeError";
  }
}
export class IndexError extends Error {
  constructor(message) {
    super(message);
    this.name = "IndexError";
  }
}
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

/** `str(exc)` — what Python prints for an exception (its message). */
export const errText = (e) => (e instanceof Error ? e.message : String(e));

// ── code points (Python indexes strings by code point; JS by UTF-16 unit) ────
/** `len(s)` */
export function cpLen(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
/** `s[a:b]` with code-point indexes (negatives count from the end, as Python's). */
export function cpSlice(s, a = 0, b = undefined) {
  const cps = Array.from(s);
  return cps.slice(a, b).join("");
}
/** Code points before UTF-16 index `i`. */
function cpIndex(s, i) {
  return cpLen(s.slice(0, i));
}

// ── Python's character classes (for patterns built with the `u` flag) ────────
/** `\s` on str = `str.isspace()`: U+0009–000D, U+001C–0020, U+0085, U+00A0, U+1680,
 * U+2000–200A, U+2028/2029, U+202F, U+205F, U+3000 (JS's `\s` adds U+FEFF and lacks
 * U+001C–001F and U+0085 — measured against Python 3.12, tests/fixtures/python-text.json). */
export const S = "[\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const S_CHARS = "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0                　";
/** `\d` on str: every decimal digit (Nd), not just 0-9. */
export const D = "\\p{Nd}";
/** `[^\W_]` — `\w` minus the underscore: letters and every number category. */
export const ALNUM = "[\\p{L}\\p{N}]";
/** `[^\W\d_]` — `\w` minus digits and underscore: letters plus the non-decimal numbers
 * (Nl, No — "Ⅷ", "¼"; measured). */
export const LETTER = "[\\p{L}\\p{Nl}\\p{No}]";

/** `str.isspace()` for one character. */
export const isSpace = (ch) => ch !== "" && S_CHARS.includes(ch);

/** `str.strip()` / `lstrip()` / `rstrip()` with no argument — Python's whitespace. */
export function pyStrip(s) {
  return pyRstrip(pyLstrip(s));
}
export function pyLstrip(s) {
  s = String(s);
  let a = 0;
  while (a < s.length && S_CHARS.includes(s[a])) a++;
  return s.slice(a);
}
export function pyRstrip(s) {
  s = String(s);
  let b = s.length;
  while (b > 0 && S_CHARS.includes(s[b - 1])) b--;
  return s.slice(0, b);
}
/** `str.split()` with no argument. */
export function pySplit(s) {
  const t = pyStrip(s);
  return t ? t.split(new RegExp(`${S}+`, "u")) : [];
}
/** `str.strip(chars)`. */
export function stripChars(s, chars) {
  s = String(s);
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}
/** `str.count(sub)` (non-overlapping; an empty `sub` counts len+1, as Python). */
export function pyCount(s, sub) {
  if (sub === "") return cpLen(s) + 1;
  return s.split(sub).length - 1;
}

/** `int(s)` of a string of decimal digits in ANY script (Python's int() reads "٣" as 3). */
export function pyIntDigits(s) {
  let n = 0;
  for (const ch of s) {
    let cp = ch.codePointAt(0);
    if (cp >= 0x30 && cp <= 0x39) {
      n = n * 10 + (cp - 0x30);
      continue;
    }
    // Unicode lays every decimal digit out in contiguous runs of ten, zero first; a block can
    // hold several runs back to back (the mathematical digits), so walk to the block start.
    const isNd = (c) => /\p{Nd}/u.test(String.fromCodePoint(c));
    let start = cp;
    while (isNd(start - 1)) start--;
    cp = (cp - start) % 10;
    n = n * 10 + cp;
  }
  return n;
}

/** `re.escape(s)` for a JS `u`-flag pattern (only the syntax characters — u-mode refuses an
 * escaped ordinary character; the meaning is the same). */
export const reEscape = (s) => String(s).replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

/** `f"{x:.2f}"` — Python rounds a true tie (0.125) to even; toFixed would round it up. */
export function fmtFixed(x, nd) {
  const n = Number(x);
  if (!Number.isFinite(n)) return n > 0 ? "inf" : n < 0 ? "-inf" : "nan";
  // A double's exact expansion decides a tie; 40 extra digits show it.
  const s = Math.abs(n).toFixed(Math.min(100, nd + 40));
  const [ip, fp = ""] = s.split(".");
  let digits = BigInt(ip + fp.slice(0, nd));
  const rest = fp.slice(nd);
  const above = rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1)));
  const tie = rest[0] === "5" && !/[1-9]/.test(rest.slice(1));
  if (above || (tie && digits % 2n === 1n)) digits += 1n;
  let txt = digits.toString().padStart(nd + 1, "0");
  if (nd > 0) txt = `${txt.slice(0, -nd)}.${txt.slice(-nd)}`;
  return n < 0 || Object.is(n, -0) ? `-${txt}` : txt; // Python keeps the sign: "-0.00"
}

// ── dicts: a JSON object is a Map here (key order), a plain object elsewhere ──
const isPlainObject = (v) =>
  v !== null && typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
/** `isinstance(v, dict)` */
export const isDict = (v) => v instanceof Map || isPlainObject(v);
/** `d.get(k, dflt)` on a Map or a plain object. */
export function dget(d, k, dflt = null) {
  if (d instanceof Map) return d.has(k) ? d.get(k) : dflt;
  if (isPlainObject(d)) return Object.hasOwn(d, k) ? d[k] : dflt;
  throw new AttributeError(`'${typeName(d)}' object has no attribute 'get'`);
}
/** `k in d` */
export const dhas = (d, k) => (d instanceof Map ? d.has(k) : isPlainObject(d) ? Object.hasOwn(d, k) : false);
/** `d.items()` */
export const dentries = (d) => (d instanceof Map ? [...d.entries()] : isPlainObject(d) ? Object.entries(d) : []);
/** A Map view of a dict (a plain object's own order — no integer-like keys in literals). */
export function asMap(d) {
  if (d instanceof Map) return d;
  if (d == null) return new Map();
  if (isPlainObject(d)) return new Map(Object.entries(d));
  throw new AttributeError(`'${typeName(d)}' object has no attribute 'items'`);
}
/** `{**a, **b}` — a's keys in a's order, b's values win, b's new keys appended. */
export function mergeDicts(a, b) {
  const out = new Map(asMap(a));
  for (const [k, v] of dentries(b)) out.set(k, v);
  return out;
}

/** Python's type name, for the error texts that reach a 500 envelope. */
export function typeName(v) {
  if (v === null || v === undefined) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "string") return "str";
  if (typeof v === "bigint") return "int";
  if (v instanceof PyFloat) return "float";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (Array.isArray(v)) return "list";
  if (isDict(v)) return "dict";
  return typeof v;
}

/** `for x in v` — a list's items, a str's characters, a dict's keys. */
export function pyIter(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [...v];
  if (v instanceof Map) return [...v.keys()];
  if (v instanceof Set) return [...v];
  if (isPlainObject(v)) return Object.keys(v);
  throw new TypeError(`'${typeName(v)}' object is not iterable`);
}

/** `bool(v)` — empty containers, 0, 0.0, "" and None are false. */
export function pyTruthy(v) {
  if (v instanceof PyFloat) return v.v !== 0; // NaN is true, as bool(nan)
  if (typeof v === "bigint") return v !== 0n;
  if (Array.isArray(v) || typeof v === "string") return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return !!v;
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

// ── json.loads ───────────────────────────────────────────────────────────────
/** Python's JSONDecodeError (a ValueError): "<msg>: line L column C (char P)", positions in
 * code points. */
export class JSONDecodeError extends ValueError {
  constructor(msg, doc, pos) {
    const cp = cpIndex(doc, pos);
    const before = doc.slice(0, pos);
    const lineno = (before.match(/\n/g) || []).length + 1;
    const nl = before.lastIndexOf("\n");
    const colno = nl === -1 ? cp + 1 : cp - cpIndex(doc, nl);
    super(`${msg}: line ${lineno} column ${colno} (char ${cp})`);
    this.name = "JSONDecodeError";
    this.pos = cp;
  }
}

class StopIteration {
  constructor(idx) {
    this.idx = idx;
  }
}

const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
const isDigit = (c) => c >= "0" && c <= "9";
const HEX = /^[0-9a-fA-F]{4}$/;

function scanString(s, end) {
  // `end` is just past the opening quote (CPython's scanstring_unicode, strict).
  const begin = end - 1;
  let out = "";
  const len = s.length;
  for (;;) {
    let next = end;
    while (next < len) {
      const c = s[next];
      if (c === '"' || c === "\\") break;
      if (c.charCodeAt(0) <= 0x1f) throw new JSONDecodeError("Invalid control character at", s, next);
      next++;
    }
    if (next >= len) throw new JSONDecodeError("Unterminated string starting at", s, begin);
    out += s.slice(end, next);
    if (s[next] === '"') return [out, next + 1];
    next++; // past the backslash
    if (next >= len) throw new JSONDecodeError("Unterminated string starting at", s, begin);
    const c = s[next];
    if (c !== "u") {
      const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (!(c in map)) throw new JSONDecodeError("Invalid \\escape", s, next - 1);
      out += map[c];
      end = next + 1;
      continue;
    }
    next++;
    end = next + 4;
    if (end >= len) throw new JSONDecodeError("Invalid \\uXXXX escape", s, next - 1);
    const h = s.slice(next, end);
    if (!HEX.test(h)) throw new JSONDecodeError("Invalid \\uXXXX escape", s, end - 5);
    let u = Number.parseInt(h, 16);
    // A high surrogate followed by `\u`: those four MUST be hex (else the error points at
    // them); a low surrogate joins the pair, anything else is read again on its own.
    if (u >= 0xd800 && u <= 0xdbff && end + 6 < len && s[end] === "\\" && s[end + 1] === "u") {
      const h2 = s.slice(end + 2, end + 6);
      if (!HEX.test(h2)) throw new JSONDecodeError("Invalid \\uXXXX escape", s, end + 1);
      const u2 = Number.parseInt(h2, 16);
      if (u2 >= 0xdc00 && u2 <= 0xdfff) {
        u = 0x10000 + ((u - 0xd800) << 10) + (u2 - 0xdc00);
        end += 6;
      }
    }
    out += String.fromCodePoint(u);
  }
}

function matchNumber(s, start) {
  let idx = start;
  const end = s.length - 1;
  if (s[idx] === "-") {
    idx++;
    if (idx > end) throw new StopIteration(start);
  }
  if (s[idx] >= "1" && s[idx] <= "9") {
    idx++;
    while (idx <= end && isDigit(s[idx])) idx++;
  } else if (s[idx] === "0") idx++;
  else throw new StopIteration(start);
  let isFloat = false;
  if (idx < end && s[idx] === "." && isDigit(s[idx + 1])) {
    isFloat = true;
    idx += 2;
    while (idx <= end && isDigit(s[idx])) idx++;
  }
  if (idx < end && (s[idx] === "e" || s[idx] === "E")) {
    const eStart = idx;
    idx++;
    if (idx < end && (s[idx] === "-" || s[idx] === "+")) idx++;
    while (idx <= end && isDigit(s[idx])) idx++;
    if (isDigit(s[idx - 1])) isFloat = true;
    else idx = eStart;
  }
  const text = s.slice(start, idx);
  if (isFloat) return [new PyFloat(Number(text)), idx];
  const n = Number(text);
  return [Number.isSafeInteger(n) ? (Object.is(n, -0) ? 0 : n) : BigInt(text), idx];
}

function scanOnce(s, idx) {
  if (idx >= s.length) throw new StopIteration(idx);
  const c = s[idx];
  if (c === '"') return scanString(s, idx + 1);
  if (c === "{") return parseObject(s, idx + 1);
  if (c === "[") return parseArray(s, idx + 1);
  if (c === "n" && s.startsWith("null", idx)) return [null, idx + 4];
  if (c === "t" && s.startsWith("true", idx)) return [true, idx + 4];
  if (c === "f" && s.startsWith("false", idx)) return [false, idx + 5];
  if (c === "N" && s.startsWith("NaN", idx)) return [new PyFloat(Number.NaN), idx + 3];
  if (c === "I" && s.startsWith("Infinity", idx)) return [new PyFloat(Number.POSITIVE_INFINITY), idx + 8];
  if (c === "-" && s.startsWith("-Infinity", idx)) return [new PyFloat(Number.NEGATIVE_INFINITY), idx + 9];
  return matchNumber(s, idx);
}

function parseObject(s, idx) {
  const out = new Map();
  const end = s.length - 1;
  while (idx <= end && isWs(s[idx])) idx++;
  if (idx > end || s[idx] !== "}") {
    for (;;) {
      if (idx > end || s[idx] !== '"') {
        throw new JSONDecodeError("Expecting property name enclosed in double quotes", s, idx);
      }
      const [key, afterKey] = scanString(s, idx + 1);
      idx = afterKey;
      while (idx <= end && isWs(s[idx])) idx++;
      if (idx > end || s[idx] !== ":") throw new JSONDecodeError("Expecting ':' delimiter", s, idx);
      idx++;
      while (idx <= end && isWs(s[idx])) idx++;
      const [val, next] = scanOnce(s, idx);
      out.set(key, val); // a repeated key keeps its first place and its last value, as a dict
      idx = next;
      while (idx <= end && isWs(s[idx])) idx++;
      if (idx <= end && s[idx] === "}") break;
      if (idx > end || s[idx] !== ",") throw new JSONDecodeError("Expecting ',' delimiter", s, idx);
      idx++;
      while (idx <= end && isWs(s[idx])) idx++;
    }
  }
  return [out, idx + 1];
}

function parseArray(s, idx) {
  const out = [];
  const end = s.length - 1;
  while (idx <= end && isWs(s[idx])) idx++;
  if (idx > end || s[idx] !== "]") {
    for (;;) {
      const [val, next] = scanOnce(s, idx);
      out.push(val);
      idx = next;
      while (idx <= end && isWs(s[idx])) idx++;
      if (idx <= end && s[idx] === "]") break;
      if (idx > end || s[idx] !== ",") throw new JSONDecodeError("Expecting ',' delimiter", s, idx);
      idx++;
      while (idx <= end && isWs(s[idx])) idx++;
    }
  }
  return [out, idx + 1];
}

/**
 * `json.loads(text)`: objects as Maps (file order), floats as PyFloat, integers past 2^53 as
 * BigInt, NaN/Infinity accepted — and Python's JSONDecodeError (a ValueError) on bad input.
 */
export function loads(text) {
  const s = String(text);
  if (s.startsWith("﻿")) throw new JSONDecodeError("Unexpected UTF-8 BOM (decode using utf-8-sig)", s, 0);
  let idx = 0;
  while (idx < s.length && isWs(s[idx])) idx++;
  let obj;
  let end;
  try {
    [obj, end] = scanOnce(s, idx);
  } catch (e) {
    if (e instanceof StopIteration) throw new JSONDecodeError("Expecting value", s, e.idx);
    throw e;
  }
  while (end < s.length && isWs(s[end])) end++;
  if (end !== s.length) throw new JSONDecodeError("Extra data", s, end);
  return obj;
}

/** A `loads` result as plain JavaScript: Maps → objects, PyFloat → number, BigInt → number
 * (for values the code reads, not re-writes — a config, the workshop state). */
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
export const readJson = (p) => loads(readText(p));

// ── json.dumps ───────────────────────────────────────────────────────────────
function strLit(s, ensureAscii) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = s.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || (ensureAscii && c > 0x7e)) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

const floatJson = (x) => (Number.isNaN(x) ? "NaN" : !Number.isFinite(x) ? (x > 0 ? "Infinity" : "-Infinity") : pyFloat(x));

/** Python's str ordering (code points), for sort_keys. */
export function cpCompare(a, b) {
  if (a === b) return 0;
  const A = a[Symbol.iterator]();
  const B = b[Symbol.iterator]();
  for (;;) {
    const x = A.next();
    const y = B.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const d = x.value.codePointAt(0) - y.value.codePointAt(0);
    if (d) return d;
  }
}

/**
 * `json.dumps(value, indent=, ensure_ascii=, sort_keys=, separators=)` over Maps, plain
 * objects, arrays, PyFloat, BigInt and the primitives. A whole-number JS number is an int; a
 * PyFloat (or a fractional number) is a float.
 */
export function dumps(value, { indent = null, ensureAscii = true, sortKeys = false, separators = null } = {}) {
  const [itemSep, keySep] = separators || (indent != null ? [",", ": "] : [", ", ": "]);
  const pad = typeof indent === "number" ? " ".repeat(indent) : indent;
  const enc = (v, depth) => {
    if (v === null || v === undefined) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (v instanceof PyFloat) return floatJson(v.v);
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : floatJson(v);
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string") return strLit(v, ensureAscii);
    const wrap = (open, close, parts) => {
      if (!parts.length) return `${open}${close}`;
      if (pad == null) return `${open}${parts.join(itemSep)}${close}`;
      const inner = `\n${pad.repeat(depth + 1)}`;
      return `${open}${inner}${parts.join(itemSep + inner)}\n${pad.repeat(depth)}${close}`;
    };
    if (Array.isArray(v)) return wrap("[", "]", v.map((x) => enc(x, depth + 1)));
    if (isDict(v)) {
      let entries = dentries(v).filter(([, x]) => x !== undefined);
      if (sortKeys) entries = [...entries].sort((p, q) => cpCompare(String(p[0]), String(q[0])));
      return wrap(
        "{",
        "}",
        entries.map(([k, x]) => `${strLit(String(k), ensureAscii)}${keySep}${enc(x, depth + 1)}`),
      );
    }
    throw new TypeError(`Object of type ${typeName(v)} is not JSON serializable`);
  };
  return enc(value, 0);
}

// ── the locale walk (jsonio.py) ──────────────────────────────────────────────

/**
 * Flattens a nested locale object into {"a.b.c": "text"} (a Map, in file order). Non-dict
 * leaves are stringified (locale files hold strings; anything else is someone's bug
 * surfaced, not hidden).
 */
export function flatten(obj, prefix = "", out = new Map()) {
  if (!isDict(obj)) throw new AttributeError(`'${typeName(obj)}' object has no attribute 'items'`);
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
    } else if (dhas(values, path)) out.set(k, dget(values, path));
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
  return new RegExp(`${reEscape(dget(placeholder, "prefix"))}.*?${reEscape(dget(placeholder, "suffix"))}`, "gsu");
}

/** `pattern.findall(s)` for a group-less pattern. */
export const findAll = (re, s) => [...String(s).matchAll(re)].map((m) => m[0]);
