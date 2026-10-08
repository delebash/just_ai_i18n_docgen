// SPDX-License-Identifier: MIT
// Port of tests/test_confirm.py — the confirmation pass. The routing decision is the part
// worth asserting, with no model running. The measured behaviours: an echo counts as SAME
// (15 of 71 answered that way), a proposal is data never applied, an engine error is a
// routed outcome, and an annotation EXPIRES with its strings exactly like an acceptance.
import { expect, test } from "vitest";
import { acceptanceHash } from "../src/accepted.js";
import { attachConfirmations, buildConfirmPrompt, CONFIRM_CODE, confirmIdentical, isSameVerdict } from "../src/confirm.js";

test("is_same_verdict_takes_same_in_any_case_and_the_echo", () => {
  expect(isSameVerdict("SAME", "Color")).toBe(true);
  expect(isSameVerdict("same", "Color")).toBe(true);
  expect(isSameVerdict("Same.", "Color"), "a trailing full stop is still SAME").toBe(true);
  // The echo: the model treats "return it unchanged" and "say SAME" as one statement.
  expect(isSameVerdict("Color", "Color")).toBe(true);
  expect(isSameVerdict("Color.", "Color")).toBe(true);
  // A real translation is NOT same.
  expect(isSameVerdict("Libros", "Books")).toBe(false);
});

test("confirm_prompt_names_the_glossary_and_the_language", () => {
  const p = buildConfirmPrompt({ targetLang: "es", context: "a writing app", doNotTranslate: ["JustWrite", "TODO"] });
  expect(p.includes("es") && p.includes("a writing app")).toBe(true);
  expect(p).toContain("JustWrite, TODO");
  const bare = buildConfirmPrompt({ targetLang: "es" });
  expect(bare, "no glossary, no glossary line").not.toContain("always SAME:");
});

test("confirm_identical_routes_cleared_proposed_and_failed", async () => {
  const SRC = { "common.no": "No", "sidebar.books": "Books", "bad.key": "Boom" };
  const answers = { "common.no": "SAME", "sidebar.books": "Libros" };
  const ask = (_system, source) => {
    if (source === "Boom") throw new Error("engine down");
    return answers[Object.keys(SRC).find((k) => SRC[k] === source)];
  };
  const DST = { ...SRC }; // all byte-identical — that is why they are candidates
  const result = await confirmIdentical({ keys: Object.keys(SRC), sourceFlat: SRC, targetFlat: DST, targetLang: "es", ask });
  expect(result.cleared.map((c) => c.key)).toEqual(["common.no"]);
  expect(result.proposed).toEqual([{ key: "sidebar.books", src: "Books", dst: "Books", suggestion: "Libros" }]);
  expect(result.failed.map((f) => f.key)).toEqual(["bad.key"]);
  expect(result.failed[0].error).toContain("engine down");
});

test("attach_confirmations_annotates_live_and_ignores_stale", () => {
  const src = { "common.no": "No", "sidebar.books": "Books" };
  const dst = { ...src };
  const findings = [
    { key: "common.no", code: CONFIRM_CODE, detail: "identical" },
    { key: "sidebar.books", code: CONFIRM_CODE, detail: "identical" },
    { key: "common.no", code: "brackets", detail: "other code untouched" },
  ];
  const liveHash = acceptanceHash({ key: "common.no", code: CONFIRM_CODE, src: "No", dst: "No" });
  const verdicts = {
    "common.no": { hash: liveHash, verdict: "same", engine: "e", suggestion: null },
    // Stale: hashed over strings that have since changed — must be IGNORED, the same expiry an
    // acceptance follows.
    "sidebar.books": { hash: "0".repeat(16), verdict: "translate", engine: "e", suggestion: "Libros" },
  };
  const out = attachConfirmations(findings, verdicts, src, dst);
  expect(out[0].confirmed === "same" && out[0].confirmedBy === "e").toBe(true);
  expect("confirmed" in out[1], "a stale verdict is retired, not shown").toBe(false);
  expect("confirmed" in out[2], "other codes are never annotated").toBe(false);
});
