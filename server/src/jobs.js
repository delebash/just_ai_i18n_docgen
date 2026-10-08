// SPDX-License-Identifier: MIT
// Long runs, and the three things a reviewer needs from one. The port of jobs.py (ported from
// just-ai-help's `server/jobs.js`). A full catalogue is ~52 minutes on the shipped local
// model, which rules out a POST that translates and then responds. A run is a JOB — started,
// streamed, cancellable, and rejoinable after a reload.
//
// THREE RULES, each of which is a test:
//   1. A job writes ONLY proposals. The locale file is byte-identical when it finishes.
//   2. ONE job at a time. A second start raises JobBusyError (the 409). Two concurrent runs
//      would both write proposals for overlapping keys and the loser's work would vanish
//      silently — the exact bug class this project exists to prevent.
//   3. Cancelling loses nothing: it stops on a batch boundary, keeps every proposal already
//      staged, and leaves the catalogue untouched.
//
// Subscribers are plain callbacks; the workspace router adapts them to SSE. Keeping transport
// out of here is what lets the tests drive a whole job without a socket.
//
// Python's worker thread is an async task here (build sheet rule 6); its lock around the
// subscriber list never spanned anything, so it is gone.

import { randomUUID } from "node:crypto";
import { AsyncEvent, background } from "@delebash/llm-runner/platform/asyncutil";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { asMap, dget, errText } from "./jsonio.js";
import { translateLanguage } from "./loop.js";
import { finishRun, putProposal, startRun } from "./state.js";

const log = getLogger("just_ai_i18n_docgen.jobs");
const TERMINAL = new Set(["done", "cancelled", "failed"]);
const monotonic = () => performance.now() / 1000;

export class JobBusyError extends RuntimeError {
  constructor(message) {
    super(message);
    this.name = "JobBusyError";
  }
}

/** `time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())` */
const gmtStamp = () => `${new Date().toISOString().slice(0, 19)}Z`;

export class JobManager {
  constructor({ store = null, log: logFn = () => {} } = {}) {
    this.store = store;
    this.log = logFn;
    this.current = null;
    this._subs = [];
  }

  /** What a reloaded page asks for, so it can rejoin a run it did not start. */
  status() {
    const j = this.current;
    if (j === null) return null;
    const out = {};
    for (const k of ["id", "lang", "engine", "scope", "total", "done", "requests", "startedAt", "state", "error", "failed"]) {
      out[k] = k === "failed" ? [...j[k]] : j[k];
    }
    return out;
  }

  get busy() {
    return this.current !== null && !TERMINAL.has(this.current.state);
  }

  subscribe(fn) {
    this._subs.push(fn);
    return () => {
      const i = this._subs.indexOf(fn);
      if (i >= 0) this._subs.splice(i, 1);
    };
  }

  _emit(type, data) {
    for (const fn of [...this._subs]) fn({ type, ...data });
  }

  /**
   * Starts a run over `subset` and stages every result as a proposal. Returns immediately —
   * which is what makes the endpoint a 202 rather than a 50-minute hang. `translate` is
   * injectable so tests drive the whole lifecycle — progress, cancel, failure, rejoin —
   * without an engine. `confirm` (2026-08-04 — the confirmation pass PRE-TICKS rows, and only
   * the CLI ran it before) is called after a DONE run with the byte-identical proposals
   * (Map{key: value}); annotation-only, so its failure never fails the run.
   */
  start({ lang, engine, send, scope, subset, cfg, cachePath, translate = translateLanguage, confirm = null }) {
    if (this.busy) throw new JobBusyError("a job is already running");

    const runId = this.store ? startRun(this.store, { lang, engine, scope }) : null;
    const job = {
      id: `job-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      runId,
      lang,
      engine,
      scope,
      total: asMap(subset).size,
      done: 0,
      requests: 0,
      failed: [],
      startedAt: gmtStamp(),
      startedMs: monotonic(),
      state: "running",
      error: null,
      cancelled: new AsyncEvent(),
    };
    this.current = job;
    this._emit("start", { job: this.status() });

    // The worker (Python's daemon thread). Anything that escapes `_run` is logged, never an
    // unhandled rejection.
    job.task = background(
      `job ${job.id}`,
      () => this._run(job, { send, subset, cfg, cachePath, translate, confirm }),
      log,
    );
    return this.status();
  }

  async _run(job, { send, subset, cfg, cachePath, translate, confirm = null }) {
    const seen = new Set();

    // Called after every batch. Staging here rather than at the end is what lets a reviewer
    // start work while the run continues, and what makes a cancel keep the work already done.
    const stage = (partial) => {
      for (const [key, value] of asMap(partial)) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (this.store) putProposal(this.store, { lang: job.lang, key, engine: job.engine, value });
        this._emit("item", { key, value, lang: job.lang, engine: job.engine });
      }
      job.done = seen.size;
      this._emit("progress", { done: job.done, total: job.total });
    };

    try {
      const result = await translate({
        sourceFlat: subset,
        existingFlat: new Map(),
        lang: job.lang,
        cfg,
        cachePath,
        send,
        force: true,
        log: this.log,
        isCancelled: () => job.cancelled.isSet(),
        onBatch: stage,
      });
      // The final flush: onBatch fires per batch, but the values are also returned, and a
      // run of one short batch would otherwise stage nothing.
      stage(result.values);
      job.requests = result.requests;
      job.failed = result.failed;
      if (result.cancelled) job.state = "cancelled";
      else {
        // The confirmation pass (the design: pre-tick the obvious). Runs in a NON-terminal
        // "confirming" state so `busy` HOLDS (a second job cannot start over the confirm's
        // engine calls — the 2026-08-05 audit's busy-guard escape) and Cancel still works
        // (the callable checks between keys). Annotations only; a confirm failure never fails
        // the run whose translations already staged; the run's final state reflects the
        // TRANSLATE outcome.
        if (confirm !== null) {
          const identical = new Map([...asMap(result.values)].filter(([k, v]) => dget(subset, k) === v));
          if (identical.size) {
            job.state = "confirming";
            this._emit("confirming", { count: identical.size, lang: job.lang });
            try {
              await confirm(identical, { isCancelled: () => job.cancelled.isSet() });
            } catch (err) {
              this._emit("confirm-error", { message: errText(err) }); // annotation-only
            }
          }
        }
        job.state = "done";
      }
    } catch (err) {
      // a dead engine is a job outcome
      job.state = "failed";
      job.error = errText(err);
      this._emit("error", { message: errText(err) });
    } finally {
      if (this.store && job.runId) {
        finishRun(this.store, job.runId, {
          keys: job.done,
          requests: job.requests,
          elapsedMs: Math.trunc((monotonic() - job.startedMs) * 1000),
          failed: job.failed.length,
        });
      }
      // Named by key, never swallowed — a run that could not deliver a key says which one.
      // The silent-skip bug is the reason this project exists.
      this._emit("done", { job: this.status() });
    }
  }

  /** Stops after the batch in flight. Everything already staged stays staged. */
  cancel() {
    if (!this.busy) return null;
    this.current.cancelled.set();
    this._emit("cancelling", { id: this.current.id });
    return this.status();
  }

  /** Waits for the active run — tests only; nothing in the server blocks on a job. */
  async settled(timeout = 30) {
    const t = this.current?.task;
    if (t) {
      let timer;
      await Promise.race([t, new Promise((r) => (timer = setTimeout(r, timeout * 1000)))]);
      clearTimeout(timer);
    }
    return this.status();
  }
}
