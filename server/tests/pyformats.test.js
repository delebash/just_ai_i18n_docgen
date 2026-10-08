// SPDX-License-Identifier: MIT
// No Python twin: checks jsonio.js's Python text semantics against what Python 3.12 itself
// answered (tests/fixtures/python-text.json, written by the docgen venv's interpreter):
// json.loads values and error words, str() of leaves, json.dumps (Maps, floats, sort_keys
// in code-point order), str.strip()/split() whitespace, the .2f tie rule and the Unicode
// \s \d \w classes. Every other docgen module stands on these.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  D,
  digitsToInt as pyIntDigits,
  lstrip as pyLstrip,
  rstrip as pyRstrip,
  S,
  splitWs as pySplit,
  strip as pyStrip,
} from "@delebash/llm-runner/platform/py";
import { jsonLoadsExact as loads, PyFloat, pyFixed as fmtFixed, pyJson as dumps } from "@delebash/llm-runner/platform/pyjson";
import { expect, test } from "vitest";
import { ALNUM, LETTER, pyStr } from "../src/jsonio.js";

const FIX = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "python-text.json"), "utf8"));

/** The fixture's typed form → a loads()-shaped value. */
function untype(t) {
  switch (t.t) {
    case "dict":
      return new Map(t.items.map(([k, v]) => [k, untype(v)]));
    case "list":
      return t.items.map(untype);
    case "bool":
      return t.v;
    case "none":
      return null;
    case "str":
      return t.v;
    case "int": {
      const n = Number(t.s);
      return Number.isSafeInteger(n) ? n : BigInt(t.s);
    }
    case "float":
      return new PyFloat({ nan: Number.NaN, inf: Number.POSITIVE_INFINITY, "-inf": Number.NEGATIVE_INFINITY }[t.repr] ?? Number(t.repr));
    default:
      throw new Error(t.t);
  }
}

/** A loads() value → the fixture's typed form. */
function typed(v) {
  if (v instanceof Map) return { t: "dict", items: [...v].map(([k, x]) => [k, typed(x)]) };
  if (Array.isArray(v)) return { t: "list", items: v.map(typed) };
  if (typeof v === "boolean") return { t: "bool", v };
  if (v === null) return { t: "none" };
  if (typeof v === "string") return { t: "str", v };
  if (typeof v === "bigint") return { t: "int", s: v.toString() };
  if (v instanceof PyFloat) return { t: "float", repr: pyStr(v) };
  return { t: "int", s: String(v) };
}

test("loads_matches_python_values_and_error_words", () => {
  for (const c of FIX.loads) {
    if (c.error) expect(() => loads(c.in), JSON.stringify(c.in)).toThrow(c.error);
    else expect(typed(loads(c.in)), JSON.stringify(c.in)).toEqual(c.ok);
  }
});

test("str_of_a_leaf_matches_python", () => {
  for (const c of FIX.str) expect(pyStr(untype(c.in))).toBe(c.str);
});

test("dumps_matches_python", () => {
  for (const c of FIX.dumps) {
    const opts = { indent: c.kw.indent ?? null, ensureAscii: c.kw.ensure_ascii ?? true, sortKeys: !!c.kw.sort_keys };
    expect(dumps(untype(c.in), opts)).toBe(c.out);
  }
});

test("whitespace_is_pythons", () => {
  for (const c of FIX.strip) {
    expect(pyStrip(c.in)).toBe(c.strip);
    expect(pyLstrip(c.in)).toBe(c.lstrip);
    expect(pyRstrip(c.in)).toBe(c.rstrip);
    expect(pySplit(c.in)).toEqual(c.split);
  }
});

test("fixed_point_ties_round_to_even", () => {
  for (const c of FIX.fmt2) expect(fmtFixed(Number(c.x), 2), c.x).toBe(c.f);
});

test("character_classes_are_pythons", () => {
  const cps = [...FIX.classes.probe];
  const is = (cls, ch) => new RegExp(`^${cls}$`, "u").test(ch);
  cps.forEach((ch, i) => {
    const at = `U+${ch.codePointAt(0).toString(16)}`;
    expect(is(S, ch), `\\s ${at}`).toBe(FIX.classes.s[i]);
    expect(is(D, ch), `\\d ${at}`).toBe(FIX.classes.d[i]);
    expect(is(`(?:${ALNUM}|_)`, ch), `\\w ${at}`).toBe(FIX.classes.w[i]);
    expect(is(LETTER, ch), `letter ${at}`).toBe(FIX.classes.letter[i]);
    if (FIX.classes.int[i] !== null) expect(pyIntDigits(ch), `int ${at}`).toBe(FIX.classes.int[i]);
    expect(/^\p{Uppercase}/u.test(ch), `isupper ${at}`).toBe(FIX.classes.upper[i]);
  });
});
