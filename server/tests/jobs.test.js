// SPDX-License-Identifier: MIT
// Port of tests/test_jobs.py — a run's three rules (jobs.js claims "each of which is a test",
// and the overnight re-review (2026-08-02) found rules 2 and 3 were NOT; now the claim is
// true), on the kit's JobRegistry since round D2 (2026-10-28). Driven through an injectable
// translate, no engine, no socket. Python's threading.Event gates are the kit's AsyncEvent; its
// busy-wait on the worker thread is `until()`.
import { join } from "node:path";
import { JobRegistry } from "@delebash/core/platform";
import { AsyncEvent } from "@delebash/core/platform/asyncutil";
import { expect, test } from "vitest";
import { JobBusyError, startTranslateRun, TRANSLATE } from "../src/jobs.js";
import { openProject, proposalCount, runHistory } from "../src/state.js";
import { tmpDir, until } from "./helpers.js";

/** A fake loop: stages each batch via onBatch, waiting on `gate` between them and honouring
 * isCancelled on the boundary — the real loop's contract. */
function controllableTranslate(gate, batches, failed = []) {
  return async ({ isCancelled, onBatch }) => {
    const values = new Map();
    for (const batch of batches) {
      await gate.wait(10000);
      gate.clear();
      if (isCancelled()) return { values, failed: [], requests: values.size, cancelled: true };
      for (const [k, v] of Object.entries(batch)) values.set(k, v);
      onBatch(new Map(values));
    }
    return { values, failed, requests: batches.length, cancelled: false };
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

/** The job's end: its snapshot once it stopped running. */
async function ended(jobs, id) {
  await until(() => jobs.get(id).state !== "running");
  return jobs.get(id);
}

test("rule_2_one_job_at_a_time_a_second_start_is_refused", async () => {
  const dir = tmpDir();
  const jobs = new JobRegistry();
  const store = openProject(dir);
  const gate = new AsyncEvent();
  const first = startTranslateRun(jobs, startArgs(dir, { store, subset: { a: "A" }, translate: controllableTranslate(gate, [{ a: "x" }]) }));
  try {
    // across languages too: one engine, one run
    expect(() =>
      startTranslateRun(jobs, startArgs(dir, { store, lang: "fr", subset: { a: "A" }, translate: controllableTranslate(new AsyncEvent(), []) })),
    ).toThrow(JobBusyError);
    expect(jobs.list({ kind: TRANSLATE }).map((j) => j.id), "a reloaded page finds the one run").toEqual([first.id]);
  } finally {
    gate.set();
  }
  expect((await ended(jobs, first.id)).state).toBe("done");
  expect(runHistory(store).length, "the refused start recorded no run").toBe(1);
});

test("rule_3_cancel_keeps_everything_already_staged", async () => {
  const dir = tmpDir();
  const store = openProject(dir);
  const jobs = new JobRegistry();
  const gate = new AsyncEvent();
  const job = startTranslateRun(jobs, startArgs(dir, { store, subset: { a: "A", b: "B" }, translate: controllableTranslate(gate, [{ a: "x" }, { b: "y" }]) }));
  gate.set(); // let batch 1 stage
  await until(() => jobs.get(job.id).data.done >= 1);
  jobs.cancel(job.id); // stop on the boundary
  gate.set(); // release the wait; the fake sees isCancelled
  expect((await ended(jobs, job.id)).state).toBe("cancelled");
  // Everything already staged STAYS staged — cancelling loses nothing.
  expect(proposalCount(store, "es")).toBe(1);
  // And the run history records how far it got, not a lie.
  const run = runHistory(store)[0];
  expect([run.keys, run.total, run.state]).toEqual([1, 2, "cancelled"]);
  expect(run.finishedAt).not.toBeNull();
});

test("a_dead_engine_is_a_recorded_outcome_not_a_hang", async () => {
  const dir = tmpDir();
  const store = openProject(dir);
  const jobs = new JobRegistry();
  const explodingTranslate = async () => {
    throw new Error("engine offline");
  };
  const job = startTranslateRun(jobs, startArgs(dir, { store, subset: { a: "A" }, translate: explodingTranslate }));
  const st = await ended(jobs, job.id);
  expect(st.state).toBe("error");
  expect(st.error.message).toContain("engine offline");
  const run = runHistory(store)[0];
  expect(run.finishedAt, "the run closed its record").not.toBeNull();
  expect(run.state).toBe("error");
  expect(run.error, "a reloaded Runs page can say why").toContain("engine offline");
  expect(jobs.busy([TRANSLATE]), "a failed job frees the slot for the next start").toBeNull();
});

test("the_run_names_its_exhausted_keys_live_and_in_its_record", async () => {
  // Keys are never silently skipped: the exhausted ones are NAMED — on the job while it is
  // followed, and in the run record a reloaded Runs page reads (the registry forgets a finished
  // job).
  const dir = tmpDir();
  const store = openProject(dir);
  const jobs = new JobRegistry();
  const gate = new AsyncEvent();
  const events = [];
  const job = startTranslateRun(
    jobs,
    startArgs(dir, { store, subset: { a: "A", b: "B" }, translate: controllableTranslate(gate, [{ a: "x" }], ["b"]) }),
  );
  jobs.subscribe(job.id, (e) => events.push(e));
  gate.set();
  const st = await ended(jobs, job.id);
  expect(st.state).toBe("done");
  expect(st.data).toMatchObject({ lang: "es", scope: "all", total: 2, done: 1, requests: 1, failed: ["b"], phase: "translating" });
  expect(st.progress).toBe(1); // the registry's own end
  expect(events.filter((e) => e.type === "item").map((e) => [e.key, e.value])).toEqual([["a", "x"]]);
  expect(events.at(-1).type).toBe("end");
  const run = runHistory(store)[0];
  expect([run.keys, run.total, run.failed, run.failedKeys, run.state]).toEqual([1, 2, 1, ["b"], "done"]);
});

test("done_run_hands_its_identical_proposals_to_the_confirm_pass", async () => {
  // The design's pre-tick (2026-08-04 — only the CLI ran it before): a finished run calls the
  // injected confirm with EXACTLY the byte-identical proposals while the job still RUNS (phase
  // "confirming" — busy HOLDS, the 2026-08-05 busy-guard fix); a failure inside confirm never
  // fails the run whose translations already staged.
  const dir = tmpDir();
  const store = openProject(dir);
  const jobs = new JobRegistry();
  const gate = new AsyncEvent();
  const seen = [];
  const statesDuringConfirm = [];
  const events = [];
  let id = null;
  const confirm = (identical) => {
    const j = jobs.get(id);
    statesDuringConfirm.push([j.state, j.data.phase, jobs.busy([TRANSLATE]) !== null]);
    seen.push(Object.fromEntries(identical));
  };
  id = startTranslateRun(
    jobs,
    startArgs(dir, {
      store,
      subset: { same: "No", moved: "Hello", blank: "" },
      translate: controllableTranslate(gate, [{ same: "No", moved: "Hola", blank: "" }]),
      confirm,
    }),
  ).id;
  jobs.subscribe(id, (e) => events.push(e));
  gate.set();
  expect((await ended(jobs, id)).state).toBe("done");
  expect(seen, "only the byte-identical proposal is confirmed — a blank has nothing to confirm").toEqual([{ same: "No" }]);
  expect(statesDuringConfirm, "the pass runs INSIDE a busy, running job").toEqual([["running", "confirming", true]]);
  expect(events.find((e) => e.type === "confirming")).toMatchObject({ count: 1, lang: "es" });

  // A confirm that BLOWS UP is an annotation failure, not a run failure.
  const gate2 = new AsyncEvent();
  const events2 = [];
  const boom = () => {
    throw new Error("engine down");
  };
  const id2 = startTranslateRun(
    jobs,
    startArgs(dir, {
      store,
      subset: { same: "No" },
      cachePath: join(dir, "c2.json"),
      translate: controllableTranslate(gate2, [{ same: "No" }]),
      confirm: boom,
    }),
  ).id;
  jobs.subscribe(id2, (e) => events2.push(e));
  gate2.set();
  expect((await ended(jobs, id2)).state).toBe("done");
  expect(events2.find((e) => e.type === "confirm-error")?.message).toContain("engine down");

  // Cancel DURING confirming stops the pass between keys; the run stays done (the translate
  // outcome), and the callable saw the cancel flag.
  const gate3 = new AsyncEvent();
  const confirmedKeys = [];
  let id3 = null;
  const slowConfirm = (identical, { isCancelled }) => {
    for (const k of [...identical.keys()].sort()) {
      if (isCancelled()) return;
      confirmedKeys.push(k);
      jobs.cancel(id3); // cancel arrives after the first key
    }
  };
  id3 = startTranslateRun(
    jobs,
    startArgs(dir, {
      store,
      subset: { a: "A", b: "B" },
      cachePath: join(dir, "c3.json"),
      translate: controllableTranslate(gate3, [{ a: "A", b: "B" }]),
      confirm: slowConfirm,
    }),
  ).id;
  gate3.set();
  expect((await ended(jobs, id3)).state).toBe("done");
  expect(confirmedKeys, "the second key was never confirmed after cancel").toEqual(["a"]);
  expect(runHistory(store)[0].state).toBe("done");
});
