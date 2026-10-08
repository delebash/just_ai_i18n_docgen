// SPDX-License-Identifier: MIT
// Port of tests/test_state.py — workshop state: the atomic JSON store and its slices. The
// load-bearing behaviours: a corrupt file costs state never work, an unreversible action
// refuses to be recorded, and mutations re-read so a concurrent writer's change is not
// silently discarded.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  confirmations,
  dropProposal,
  lastAction,
  openProject,
  popAction,
  proposalCount,
  putConfirmation,
  putProposal,
  recordAction,
  writeJsonAtomic,
} from "../src/state.js";
import { tmpDir } from "./helpers.js";

test("open_project_creates_on_first_mutation_and_roundtrips", () => {
  const dir = tmpDir();
  const s = openProject(dir);
  putProposal(s, { lang: "es", key: "a", engine: "e1", value: "hola" });
  expect(proposalCount(openProject(dir), "es")).toBe(1);
});

test("a_corrupt_state_file_costs_state_never_work", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, ".just-ai-i18n-docgen-state.json"), "{ not json", "utf8");
  const s = openProject(dir);
  expect(s.read().version, "corrupt -> fresh empty state, no crash").toBe(1);
});

test("atomic_write_leaves_no_tmp_and_survives_reread", () => {
  const path = join(tmpDir(), "x.json");
  writeJsonAtomic(path, { a: 1 });
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ a: 1 });
  expect(existsSync(`${path}.tmp`)).toBe(false);
});

test("mutate_rereads_so_the_other_writers_change_survives", () => {
  const dir = tmpDir();
  const a = openProject(dir);
  const b = openProject(dir); // the review page and a CLI run, both open
  putProposal(a, { lang: "es", key: "k1", engine: "e", value: "v1" });
  putProposal(b, { lang: "es", key: "k2", engine: "e", value: "v2" }); // b re-reads first
  expect(proposalCount(openProject(dir), "es"), "neither write was lost").toBe(2);
});

test("record_action_requires_a_reversible_prev", () => {
  const s = openProject(tmpDir());
  expect(() => recordAction(s, { lang: "es", kind: "edit" })).toThrow(TypeError); // no prev at all — cannot be undone
  expect(() => recordAction(s, { lang: "es", kind: "explode", prev: null })).toThrow(/unknown action kind/);
});

test("pop_action_marks_undone_and_returns_prev_for_the_caller", () => {
  const s = openProject(tmpDir());
  recordAction(s, { lang: "es", key: "a", kind: "edit", prev: "old", nextValue: "new" });
  recordAction(s, { lang: "fr", key: "b", kind: "edit", prev: "ancien", nextValue: "neuf" });
  const popped = popAction(s, { lang: "es" });
  expect(popped.prev, "prev is what the caller restores").toBe("old");
  expect(lastAction(s, "es"), "the es action is spent").toBeNull();
  expect(lastAction(s, "fr").key, "the fr action is untouched").toBe("b");
});

test("confirmation_verdicts_validate_and_roundtrip", () => {
  const s = openProject(tmpDir());
  expect(() => putConfirmation(s, { lang: "es", key: "k", hash: "h", verdict: "maybe", engine: "e" })).toThrow(/unknown verdict/);
  putConfirmation(s, { lang: "es", key: "k", hash: "h1", verdict: "same", engine: "e" });
  expect(confirmations(s, "es").k.verdict).toBe("same");
  putConfirmation(s, { lang: "es", key: "k", hash: "h2", verdict: "translate", suggestion: "hola", engine: "e" });
  const v = confirmations(s, "es").k;
  expect(v.hash === "h2" && v.suggestion === "hola", "a re-ask replaces the verdict").toBe(true);
});

test("drop_proposal_by_engine_then_key", () => {
  const s = openProject(tmpDir());
  putProposal(s, { lang: "es", key: "a", engine: "e1", value: "v1" });
  putProposal(s, { lang: "es", key: "a", engine: "e2", value: "v2" });
  dropProposal(s, { lang: "es", key: "a", engine: "e1" });
  expect(proposalCount(s, "es"), "one engine's proposal gone, the key remains").toBe(1);
  dropProposal(s, { lang: "es", key: "a", engine: "e2" });
  expect(proposalCount(s, "es"), "last engine's removal removes the key").toBe(0);
});
