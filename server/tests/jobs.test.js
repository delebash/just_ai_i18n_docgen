// SPDX-License-Identifier: MIT
// Port of tests/test_jobs.py — the JobManager's three rules (jobs.js claims "each of which is
// a test", and the overnight re-review (2026-08-02) found rules 2 and 3 were NOT; now the
// claim is true). Driven through an injectable translate, no engine, no socket. Python's
// threading.Event gates are the kit's AsyncEvent; its busy-wait on the worker thread is
// `until()`.
import { join } from "node:path";
import { AsyncEvent } from "@delebash/llm-runner/platform/asyncutil";
import { expect, test } from "vitest";
import { JobBusyError, JobManager } from "../src/jobs.js";
import { openProject, proposalCount, runHistory } from "../src/state.js";
import { tmpDir, until } from "./helpers.js";

/** A fake loop: stages each batch via onBatch, waiting on `gate` between them and honouring
 * isCancelled on the boundary — the real loop's contract. */
function controllableTranslate(gate, batches) {
  return async ({ isCancelled, onBatch }) => {
    const values = new Map();
    for (const batch of batches) {
      await gate.wait(10000);
      gate.clear();
      if (isCancelled()) return { values, failed: [], requests: values.size, cancelled: true };
      for (const [k, v] of Object.entries(batch)) values.set(k, v);
      onBatch(new Map(values));
    }
    return { values, failed: [], requests: batches.length, cancelled: false };
  };
}

const startArgs = (dir, extra) => ({
  lang: "es",
  engine: "e",
  send: null,
  scope: "all",
  cfg: {},
  cachePath: join(dir, "c.json"),
  ...extra,
});

test("rule_2_one_job_at_a_time_a_second_start_is_refused", async () => {
  const dir = tmpDir();
  const jobs = new JobManager({ store: openProject(dir) });
  const gate = new AsyncEvent();
  jobs.start(startArgs(dir, { subset: { a: "A" }, translate: controllableTranslate(gate, [{ a: "x" }]) }));
  try {
    expect(() =>
      jobs.start(startArgs(dir, { subset: { a: "A" }, translate: controllableTranslate(new AsyncEvent(), []) })),
    ).toThrow(JobBusyError);
  } finally {
    gate.set();
    await jobs.settled();
  }
  expect(jobs.status().state).toBe("done");
});

test("rule_3_cancel_keeps_everything_already_staged", async () => {
  const dir = tmpDir();
  const store = openProject(dir);
  const jobs = new JobManager({ store });
  const gate = new AsyncEvent();
  jobs.start(startArgs(dir, { subset: { a: "A", b: "B" }, translate: controllableTranslate(gate, [{ a: "x" }, { b: "y" }]) }));
  gate.set(); // let batch 1 stage
  await until(() => jobs.status().done >= 1);
  jobs.cancel(); // stop on the boundary
  gate.set(); // release the wait; the fake sees isCancelled
  await jobs.settled();
  expect(jobs.status().state).toBe("cancelled");
  // Everything already staged STAYS staged — cancelling loses nothing.
  expect(proposalCount(store, "es")).toBe(1);
  // And the run history records how far it got, not a lie.
  const run = runHistory(store)[0];
  expect(run.keys === 1 && run.finishedAt !== null).toBe(true);
});

test("a_dead_engine_is_a_recorded_outcome_not_a_hang", async () => {
  const dir = tmpDir();
  const store = openProject(dir);
  const jobs = new JobManager({ store });
  const explodingTranslate = async () => {
    throw new Error("engine offline");
  };
  jobs.start(startArgs(dir, { subset: { a: "A" }, translate: explodingTranslate }));
  await jobs.settled();
  const st = jobs.status();
  expect(st.state === "failed" && st.error.includes("engine offline")).toBe(true);
  expect(runHistory(store)[0].finishedAt, "the run closed its record").not.toBeNull();
  expect(jobs.busy, "a failed job frees the slot for the next start").toBe(false);
});

test("done_run_hands_its_identical_proposals_to_the_confirm_pass", async () => {
  // The design's pre-tick (2026-08-04 — only the CLI ran it before): a finished run calls the
  // injected confirm with EXACTLY the byte-identical proposals, in a NON-terminal
  // `confirming` state (busy HOLDS — the 2026-08-05 busy-guard fix); a failure inside
  // confirm never fails the run whose translations already staged.
  const dir = tmpDir();
  const store = openProject(dir);
  const jobs = new JobManager({ store });
  const gate = new AsyncEvent();
  const seen = [];
  const statesDuringConfirm = [];
  const confirm = (identical) => {
    statesDuringConfirm.push([jobs.status().state, jobs.busy]);
    seen.push(Object.fromEntries(identical));
  };
  jobs.start(
    startArgs(dir, {
      subset: { same: "No", moved: "Hello" },
      translate: controllableTranslate(gate, [{ same: "No", moved: "Hola" }]),
      confirm,
    }),
  );
  gate.set();
  await jobs.settled();
  expect(jobs.status().state).toBe("done");
  expect(seen, "only the byte-identical proposal is confirmed").toEqual([{ same: "No" }]);
  expect(statesDuringConfirm, "the pass runs INSIDE a busy, non-terminal state").toEqual([["confirming", true]]);

  // A confirm that BLOWS UP is an annotation failure, not a run failure.
  const jobs2 = new JobManager({ store });
  const gate2 = new AsyncEvent();
  const boom = () => {
    throw new Error("engine down");
  };
  jobs2.start(
    startArgs(dir, {
      subset: { same: "No" },
      cachePath: join(dir, "c2.json"),
      translate: controllableTranslate(gate2, [{ same: "No" }]),
      confirm: boom,
    }),
  );
  gate2.set();
  await jobs2.settled();
  expect(jobs2.status().state).toBe("done");

  // Cancel DURING confirming stops the pass between keys; the run stays done (the translate
  // outcome), and the callable saw the cancel flag.
  const jobs3 = new JobManager({ store });
  const gate3 = new AsyncEvent();
  const confirmedKeys = [];
  const slowConfirm = (identical, { isCancelled }) => {
    for (const k of [...identical.keys()].sort()) {
      if (isCancelled()) return;
      confirmedKeys.push(k);
      jobs3.cancel(); // cancel arrives after the first key
    }
  };
  jobs3.start(
    startArgs(dir, {
      subset: { a: "A", b: "B" },
      cachePath: join(dir, "c3.json"),
      translate: controllableTranslate(gate3, [{ a: "A", b: "B" }]),
      confirm: slowConfirm,
    }),
  );
  gate3.set();
  await jobs3.settled();
  expect(confirmedKeys, "the second key was never confirmed after cancel").toEqual(["a"]);
  expect(jobs3.status().state).toBe("done");
});
