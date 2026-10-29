// SPDX-License-Identifier: MIT
// A translation run, and the three things a reviewer needs from one. A full catalogue is ~52
// minutes on the shipped local model, which rules out a POST that translates and then
// responds: a run is the kit's JOB (the engines plan's round D2, 2026-10-28 — the user's "Fold
// into the kit") — the app's JobRegistry (`@delebash/core/platform` jobs.js) holds its state,
// its cancel and its followers, makeJobsRouter serves it (`/v1/jobs?kind=translate` to rejoin,
// `/v1/jobs/:id/events` to follow, DELETE to cancel), and this module keeps the run's own work.
//
// THREE RULES, each of which is a test:
//   1. A job writes ONLY proposals. The locale file is byte-identical when it finishes.
//   2. ONE translation at a time, across languages. A second start raises JobBusyError (the
//      409). Two concurrent runs would both write proposals for overlapping keys and the
//      loser's work would vanish silently — the exact bug class this project exists to prevent.
//   3. Cancelling loses nothing: it stops on a batch boundary, keeps every proposal already
//      staged, and leaves the catalogue untouched.
//
// The job's fields (`update`, the snapshot's `data`): {lang, engine, scope, total, done,
// requests, failed (the exhausted keys, by name), phase: "translating" | "confirming"}; its own
// events (`emit`): `item` (a staged proposal), `confirming`, `confirm-error`. The run history
// is docgen's own record (state.js startRun/finishRun) — the registry forgets a finished job.

import { getLogger } from "@delebash/core/platform/log";
import { errText, pyGet, RuntimeError, strip } from "@delebash/core/platform/py";
import { asMap } from "./jsonio.js";
import { translateLanguage } from "./loop.js";
import { finishRun, putProposal, startRun } from "./state.js";

const log = getLogger("just_ai_i18n_docgen.jobs");
const monotonic = () => performance.now() / 1000;
const isAbort = (e) => e?.name === "AbortError" || e?.code === "ABORT_ERR";
const abortError = () => Object.assign(new Error("cancelled"), { name: "AbortError" });

/** The job kind of a translation run. */
export const TRANSLATE = "translate";

export class JobBusyError extends RuntimeError {
  constructor(message) {
    super(message);
    this.name = "JobBusyError";
  }
}

/**
 * Starts a run over `subset` on `jobs` (the app's JobRegistry) and stages every result as a
 * proposal in `store`. Returns the job's snapshot at once — which is what makes the endpoint a
 * 202 rather than a 50-minute hang. `translate` is injectable so tests drive the whole
 * lifecycle — progress, cancel, failure, rejoin — without an engine. `confirm` (2026-08-04 —
 * the confirmation pass PRE-TICKS rows, and only the CLI ran it before) is called after a DONE
 * translation with the byte-identical proposals (Map{key: value}); annotation-only, so its
 * failure never fails the run. The run's own lines ("es: 0 unchanged, 2980 to translate",
 * "batch 3: <the engine's error> (attempt 1/3)") go to docgen's log by default — until
 * 2026-10-15 they went nowhere, and a job that failed every key said nothing about why.
 */
export function startTranslateRun(
  jobs,
  { store = null, lang, engine, send, scope, subset, cfg, clientId = null, translate = translateLanguage, confirm = null, log: logFn = (line) => log.info(line) },
) {
  if (jobs.busy([TRANSLATE])) throw new JobBusyError("a job is already running");
  const total = asMap(subset).size;
  const runId = store ? startRun(store, { lang, engine, scope, total }) : null;
  const startedMs = monotonic();

  return jobs.start({ kind: TRANSLATE, key: lang, label: lang, clientId }, async ({ signal, progress, update, emit }) => {
    const seen = new Set();
    let requests = 0;
    let failed = [];
    let state = "error";
    let error = null;
    update({ lang, engine, scope, total, done: 0, requests: 0, failed: [], phase: "translating" });

    // Called after every batch. Staging here rather than at the end is what lets a reviewer
    // start work while the run continues, and what makes a cancel keep the work already done.
    const stage = (partial) => {
      for (const [key, value] of asMap(partial)) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (store) putProposal(store, { lang, key, engine, value });
        emit("item", { key, value, lang, engine });
      }
      update({ done: seen.size });
      progress(total ? seen.size / total : 1);
    };

    try {
      const result = await translate({
        sourceFlat: subset,
        existingFlat: new Map(),
        lang,
        cfg,
        send,
        force: true,
        log: logFn,
        isCancelled: () => signal.aborted,
        onBatch: stage,
      });
      // The final flush: onBatch fires per batch, but the values are also returned, and a
      // run of one short batch would otherwise stage nothing.
      stage(result.values);
      requests = result.requests;
      // Named by key, never swallowed — a run that could not deliver a key says which one.
      // The silent-skip bug is the reason this project exists.
      failed = [...result.failed];
      update({ requests, failed });
      // stopped on a batch boundary: what it staged stays staged, and the job ends cancelled
      if (result.cancelled) throw abortError();
      // The confirmation pass (the design: pre-tick the obvious). Runs while the job is still
      // running (phase "confirming"), so a second run cannot start over the confirm's engine
      // calls (the 2026-08-05 audit's busy-guard escape) and Cancel still works (the callable
      // checks between keys). Annotations only; a confirm failure never fails the run whose
      // translations already staged; a Cancel during it leaves the run done — the TRANSLATE
      // outcome.
      if (confirm !== null) {
        // (a blank source comes back as itself, and there is nothing in it to confirm)
        const identical = new Map([...asMap(result.values)].filter(([k, v]) => strip(v) && pyGet(subset, k) === v));
        if (identical.size) {
          update({ phase: "confirming" });
          emit("confirming", { count: identical.size, lang });
          try {
            await confirm(identical, { isCancelled: () => signal.aborted });
          } catch (err) {
            emit("confirm-error", { message: errText(err) }); // annotation-only
          }
        }
      }
      state = "done";
      return null;
    } catch (err) {
      // a dead engine is a job outcome (the registry records it as "error", its message kept)
      state = signal.aborted || isAbort(err) ? "cancelled" : "error";
      if (state === "error") error = errText(err);
      throw err;
    } finally {
      if (store && runId) {
        finishRun(store, runId, {
          keys: seen.size,
          requests,
          elapsedMs: Math.trunc((monotonic() - startedMs) * 1000),
          failed: failed.length,
          failedKeys: failed,
          state,
          error,
        });
      }
    }
  });
}
