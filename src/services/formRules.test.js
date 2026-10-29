// SPDX-License-Identifier: MIT
// The boxes that sit in a form but may be left empty take their schema's length rule and never "required": Setup's
// add-a-term box (empty whenever nothing is being added — a required rule there refused every Save, found by the
// e2e's create-flow 2026-10-29), Review's translation box (an empty one saves a blank translation, as the server
// takes it) and the reviewer's name (none is allowed). The rules are the kit's schemaRules over the routes' own
// schemas (app-structure §15).
import { schemaRules } from "@delebash/ui";
import { ReviewerIn, SetupIn, TERM_MAX, TermIn } from "just-ai-i18n-docgen-server/schemas/setup.js";
import { Text, TEXT_MAX } from "just-ai-i18n-docgen-server/schemas/workspace.js";
import { expect, test } from "vitest";

/** The first message a value's rules give, or true when every rule passes. */
const check = (rules, v) => {
  for (const r of rules) {
    const out = r(v);
    if (out !== true) return out;
  }
  return true;
};

test("the boxes that may be empty pass empty, and refuse past their limit", () => {
  const boxes = [
    [schemaRules(TermIn).term, TERM_MAX],
    [schemaRules({ properties: { value: Text } }).value, TEXT_MAX],
    [schemaRules(ReviewerIn).reviewer, 200],
  ];
  for (const [rules, max] of boxes) {
    expect(check(rules, "")).toBe(true);
    expect(check(rules, "x".repeat(max))).toBe(true);
    expect(check(rules, "x".repeat(max + 1))).not.toBe(true);
  }
});

test("Setup's path box is required", () => {
  expect(check(schemaRules(SetupIn).path, "")).not.toBe(true);
  expect(check(schemaRules(SetupIn).path, "C:/app/src/i18n/locales/en.json")).toBe(true);
});
