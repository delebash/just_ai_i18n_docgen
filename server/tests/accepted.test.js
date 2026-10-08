// SPDX-License-Identifier: MIT
// Port of tests/test_accepted.py — accepted findings (ported from just-ai-help's
// `test/accepted.test.js`). The load-bearing tests are not "an acceptance is quiet" — they
// are the three ways an acceptance must EXPIRE, because a mechanism never seen to STOP
// suppressing is indistinguishable from one that suppresses forever.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  acceptanceEntry,
  acceptanceHash,
  loadAccepted,
  partitionAccepted,
  saveAccepted,
  UNKNOWN_REVIEWER,
} from "../src/accepted.js";
import { tmpDir } from "./helpers.js";

const SRC = { "common.no": "No" };
const DST = { "common.no": "No" };
const FINDING = [{ key: "common.no", code: "untranslated", detail: "identical to the source string" }];

function accept(findings, sourceFlat, targetFlat) {
  const store = {};
  for (const f of findings) {
    const entry = acceptanceEntry({ key: f.key, code: f.code, src: sourceFlat[f.key], dst: targetFlat[f.key] });
    store[acceptanceHash({ key: entry.key, code: entry.code, src: entry.src, dst: entry.dst })] = entry;
  }
  return store;
}

test("an_accepted_finding_stops_counting_but_is_still_returned_never_dropped", () => {
  const store = accept(FINDING, SRC, DST);
  const [findings, accepted] = partitionAccepted(FINDING, store, SRC, DST);
  expect(findings).toEqual([]);
  // The caller can always report it. A suppression the reader cannot see is the bug this
  // project was written in response to.
  expect(accepted.length).toBe(1);
  expect(accepted[0].key).toBe("common.no");
});

test("bites_changing_the_source_revives_the_acceptance", () => {
  // "No" -> "No" is correct Spanish; "No chapters" -> "No chapters" is a skipped string, and a
  // standing per-key exemption would have hidden it forever.
  const store = accept(FINDING, SRC, DST);
  const [findings, accepted] = partitionAccepted(FINDING, store, { "common.no": "No chapters" }, DST);
  expect(findings.length, "a changed source must come back as a finding").toBe(1);
  expect(accepted).toEqual([]);
});

test("bites_editing_the_target_revives_the_acceptance", () => {
  const store = accept(FINDING, SRC, DST);
  const [findings] = partitionAccepted(FINDING, store, SRC, { "common.no": "Nope" });
  expect(findings.length, "an edited target must come back as a finding").toBe(1);
});

test("bites_accepting_one_code_does_not_hide_a_different_code_on_the_same_key", () => {
  const src = { "a.k": "Headless access" };
  const dst = { "a.k": "Acceso sin interfaz (headless)" };
  const brackets = [{ key: "a.k", code: "brackets", detail: "…" }];
  const store = accept(brackets, src, dst);

  const both = [...brackets, { key: "a.k", code: "placeholder-changed", detail: "…" }];
  const [findings, accepted] = partitionAccepted(both, store, src, dst);
  expect(findings.map((f) => f.code)).toEqual(["placeholder-changed"]);
  expect(accepted.map((f) => f.code)).toEqual(["brackets"]);
});

test("the_hash_separates_fields_that_would_otherwise_concatenate_the_same", () => {
  // key "a|b" + code "c" must not collide with key "a" + code "b|c".
  const a = acceptanceHash({ key: "a|b", code: "c", src: "x", dst: "y" });
  const b = acceptanceHash({ key: "a", code: "b|c", src: "x", dst: "y" });
  expect(a).not.toBe(b);
  expect(a, "and it is stable").toBe(acceptanceHash({ key: "a|b", code: "c", src: "x", dst: "y" }));
});

test("the_accepted_file_round_trips_and_holds_data_only", () => {
  const path = join(tmpDir(), "es.accepted.json");
  saveAccepted(path, accept(FINDING, SRC, DST));

  const onDisk = JSON.parse(readFileSync(path, "utf8"));
  // JSON is for parsers — no prose, no metadata keys.
  expect(Object.keys(onDisk).some((k) => k.startsWith("_"))).toBe(false);
  const entry = Object.values(onDisk).find((v) => v && typeof v === "object");
  expect(entry.key).toBe("common.no");
  expect(entry.code).toBe("untranslated");
  expect(entry.src === "No" && entry.dst === "No").toBe(true);
  // Provenance: an unclaimed verdict says so rather than borrowing a name.
  expect(entry.by).toBe(UNKNOWN_REVIEWER);
  expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const loaded = loadAccepted(path);
  expect(partitionAccepted(FINDING, loaded, SRC, DST)[0]).toEqual([]);
});

test("a_corrupt_or_missing_sidecar_costs_a_re_review_never_a_wrong_pass", () => {
  const dir = tmpDir();
  expect(loadAccepted(join(dir, "nope.json"))).toEqual({});
  const bad = join(dir, "es.accepted.json");
  writeFileSync(bad, "{ not json", "utf8");
  expect(loadAccepted(bad)).toEqual({});
  // Fails toward showing the finding, which is the only safe direction.
  expect(partitionAccepted(FINDING, loadAccepted(bad), SRC, DST)[0].length).toBe(1);
});

test("underscore_keys_are_skipped_on_read", () => {
  const path = join(tmpDir(), "es.accepted.json");
  const store = accept(FINDING, SRC, DST);
  writeFileSync(path, JSON.stringify({ ...store, _why: "old prose" }), "utf8");
  expect(Object.keys(loadAccepted(path)).length, "_why must not be read back as an acceptance").toBe(1);
});
