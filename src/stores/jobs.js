// SPDX-License-Identifier: MIT
// Runs — start (202), follow, cancel, history. A run is the kit's server job (the engines plan's
// round D2, 2026-10-28): the server's JobRegistry holds it, and this store follows it with the
// kit's runServerJob — one task per language in the shared AI-task queue (the strip, the
// AI-tasks panel, their Cancel: the AI-call convention 2026-08-08), its events through the
// server transport (the access token rides), polling again if the stream drops. A job stages
// PROPOSALS only; the review store's applyProposal is the human action that writes.
import { defineStore } from "pinia";
import { del, get, post, pushToast, reportError, runServerJob } from "@delebash/ui";
import { i18n } from "../i18n/index.js";
import { langName } from "../services/langs.js";

const t = (...args) => i18n.global.t(...args);

/** A run's card in one shape, from the job this window follows or from a run record. (The start's
 *  answer is the job before its work's first update: its fields arrive with the first frame.) */
function jobView(job) {
  const d = job.data || {};
  return {
    lang: d.lang ?? job.key,
    scope: d.scope ?? "",
    total: d.total ?? 0,
    done: d.done ?? 0,
    requests: d.requests ?? 0,
    failed: d.failed ?? [],
    state: job.state,
    phase: d.phase ?? null,
    error: job.error?.message ?? null,
  };
}
function recordView(r) {
  return {
    lang: r.lang,
    scope: r.scope,
    total: r.total ?? 0,
    done: r.keys ?? 0,
    requests: r.requests ?? 0,
    failed: r.failedKeys ?? [],
    state: r.state,
    phase: null,
    error: r.error ?? null,
  };
}

export const useJobsStore = defineStore("jobs", {
  state: () => ({
    job: null, // the run this window follows, or the last one it followed (the kit job's snapshot)
    runs: [],
    starting: false,
    // the run list's load (app-structure §17): running, come from the server at least once, or failed (its error)
    loading: false,
    loaded: false,
    loadFailed: null,
    queue: [], // languages still waiting when a multi-select run goes sequential
    queueScope: null,
    _following: null, // the id of the job being followed
  }),
  getters: {
    running: (s) => s.job?.state === "running",
    /** The Runs page's card: the running job, else the newest run record — the registry forgets a finished
     *  job, so after a reload the record is what says how the last run ended and which keys it couldn't
     *  deliver. A record from before round D2 has no state and shows no card. */
    run(s) {
      if (s.job?.state === "running") return jobView(s.job);
      const last = s.runs[0];
      return last?.state ? recordView(last) : null;
    },
  },
  actions: {
    async refresh() {
      this.loading = true;
      let live;
      try {
        let hist;
        [live, hist] = await Promise.all([get("/v1/jobs?kind=translate"), get("/v1/runs")]);
        this.runs = hist?.runs ?? [];
        this.loaded = true;
        this.loadFailed = null;
      } catch (e) {
        // the page says so, with Retry — never an empty history that reads as "no runs"
        this.loadFailed = e;
        return;
      } finally {
        this.loading = false;
      }
      // Rejoining a live run (a reload mid-run, another window's): it gets its task on the strip and
      // the AI-tasks panel and its events, as a run started here — a rejoined run was invisible
      // everywhere but the raw state once (audit 2026-08-05).
      const job = live?.jobs?.[0];
      if (job) this._follow(job);
    },
    /** Follow `job` (a snapshot) to its end, then the next language in the queue. */
    _follow(job) {
      if (this._following === job.id) return;
      this._following = job.id;
      this.job = job;
      const lang = job.data?.lang ?? job.key;
      runServerJob({
        start: async () => job,
        feature: "translate",
        label: this.queue.length
          ? t("jobs.translatingThen", { lang: langName(lang), queue: this.queue.map(langName).join(", ") })
          : t("jobs.translating", { lang: langName(lang) }),
        meta: { lang },
        // the strip's own n/m readout, while the run knows its size
        describe: (j) => (j.data?.total ? `${j.data.done ?? 0}/${j.data.total}` : ""),
        onJob: (j) => {
          this.job = j;
        },
        onEvent: (e) => this._onEvent(e),
      })
        .then(
          () => "done",
          // a failure is on the task's row already (the strip, the panel); a cancel ends the queue
          (e) => (e?.name === "AbortError" ? "cancelled" : "failed"),
        )
        .then(async (outcome) => {
          if (this._following === job.id) this._following = null;
          if (outcome === "cancelled") this.queue = [];
          await this.refresh();
          this._advanceQueue();
        });
    },
    // The confirmation pass (2026-08-05: the server emitted these and nobody listened —
    // pre-ticks appeared unexplained or silently never appeared).
    _onEvent(e) {
      if (e.type === "confirming") pushToast({ message: t("jobs.confirming", { n: e.count }, e.count) });
      else if (e.type === "confirm-error") {
        pushToast({ kind: "error", title: t("jobs.confirmFailed"), description: t("jobs.confirmFailedBody", { message: e.message }) });
      }
    },
    async start({ lang, scope, keys = null, presetId = null }) {
      this.starting = true;
      try {
        // the start answers first, so a refusal (409 while one runs, a scope that selects nothing)
        // reaches the caller before any task opens
        const job = await post("/v1/jobs", { lang, scope, keys, presetId });
        this._follow(job);
        return job;
      } finally {
        this.starting = false;
      }
    },
    // The dashboard's multi-select: the server runs ONE job at a time (by design —
    // one engine, one queue), so extra languages wait here and each run's end starts the next.
    async startMany(langs, scope) {
      const [first, ...rest] = langs;
      this.queue = rest;
      this.queueScope = scope;
      try {
        return await this.start({ lang: first, scope });
      } catch (e) {
        // A failed FIRST start must not strand a silent queue that would fire
        // whenever some later run finishes (audit 2026-08-05).
        this.queue = [];
        throw e;
      }
    },
    async _advanceQueue() {
      if (!this.queue.length || this.running) return;
      const lang = this.queue.shift();
      try {
        await this.start({ lang, scope: this.queueScope || "pending" });
      } catch (e) {
        this.queue = []; // a failed start must not strand a silent queue
        reportError(e); // nobody pressed a button for this one, so nothing else would say it
      }
    },
    /** Stop the running translation (it keeps what it staged): its task ends as cancelled on the strip. */
    async cancel() {
      this.queue = []; // cancelling means stop — never auto-start the next language
      if (this.job?.state === "running") await del(`/v1/jobs/${encodeURIComponent(this.job.id)}`);
    },
  },
});
