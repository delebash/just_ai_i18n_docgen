// SPDX-License-Identifier: MIT
// Port of tests/test_jsonio.py — flatten/rebuild, the locale walk all three layers share.
// (flatten and rebuild return Maps — file order; compared here as plain objects.)
import { expect, test } from "vitest";
import { flatten, rebuild, toPlain } from "../src/jsonio.js";

test("flatten_makes_dotted_paths", () => {
  expect(Object.fromEntries(flatten({ a: { b: "x", c: { d: "y" } }, e: "z" }))).toEqual({ "a.b": "x", "a.c.d": "y", e: "z" });
});

test("rebuild_keeps_source_shape_and_drops_missing_keys", () => {
  const source = { a: { b: "B", c: "C" }, d: "D" };
  const out = toPlain(rebuild(source, { "a.b": "b!", d: "d!" }));
  // a.c failed to translate → ABSENT, not silently English; checks then report `missing`.
  expect(out).toEqual({ a: { b: "b!" }, d: "d!" });
});

test("rebuild_drops_an_entire_empty_branch", () => {
  expect(toPlain(rebuild({ a: { b: "B" } }, {}))).toEqual({});
});
