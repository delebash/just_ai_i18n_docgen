// SPDX-License-Identifier: MIT
// Runs — start (202), watch (SSE with polling fallback), cancel, history. A job stages
// PROPOSALS only; the review store's applyProposal is the human action that writes.
//
// Every job REGISTERS in the kit's shared AI-task queue (useAiTasksStore) — the
// batch-owner pattern its own QC-31 comment documents: one task per language,
// setProgress renders "n/m" in the strip and the AI-tasks panel, and the panel's
// Cancel aborts through the shared controller into POST /v1/jobs/cancel. This is
// what makes translate runs visible (and cancellable) from the same window as
// model downloads — one task surface, no bespoke strip (JobStrip died 2026-08-03).
import { defineStore } from "pinia";
import { get, post, safeRequest, serverUrl, useAiTasksStore } from "@delebash/llm-ui";

const langNames = new Intl.DisplayNames(undefined, { type: "language" });
function nameOf(code) {
  try { return langNames.of(code) || code; } catch { return code; }
}

export const useJobsStore = defineStore("jobs", {
  state: () => ({
    job: null,
    runs: [],
    starting: false,
    error: "",
    queue: [],          // languages still waiting when a multi-select run goes sequential
    queueScope: null,
    _source: null,
    _task: null,        // the aiTasks handle for the RUNNING job (one per language)
  }),
  actions: {
    async refresh() {
      const cur = await safeRequest("/v1/jobs/current", null);
      this.job = cur?.job ?? null;
      const hist = await safeRequest("/v1/runs", null);
      this.runs = hist?.runs ?? [];
    },
    _openTask(lang) {
      this._closeTask("superseded");
      const tasks = useAiTasksStore();
      const remaining = this.queue.length;
      const handle = tasks.start({
        feature: "translate",
        label: `Translating ${nameOf(lang)}${remaining ? ` · then ${this.queue.map(nameOf).join(", ")}` : ""}`,
        meta: { lang },
      });
      handle.markStreaming();
      // The panel's Cancel aborts the shared controller — route it to the server.
      handle.signal.addEventListener("abort", () => {
        post("/v1/jobs/cancel", {}).catch(() => {});
        this.queue = [];
      });
      this._task = handle;
    },
    _closeTask(outcome) {
      const t = this._task;
      this._task = null;
      if (!t) return;
      if (outcome === "done") t.finish({});
      else if (outcome === "failed") t.fail(new Error(this.job?.error || "run failed"));
      else if (outcome === "cancelled") t.finish({ cancelled: true });
      else t.finish({});
    },
    async start({ lang, scope, keys = null, presetId = null }) {
      this.error = "";
      this.starting = true;
      try {
        const out = await post("/v1/jobs", { lang, scope, keys, presetId });
        this.job = out.job;
        this._openTask(lang);
        this.watch();
        return out;
      } catch (e) {
        this.error = e?.message || String(e);
        throw e;
      } finally {
        this.starting = false;
      }
    },
    // The dashboard's multi-select: the server runs ONE job at a time (by design —
    // one engine, one queue), so extra languages wait client-side and each `done`
    // event starts the next.
    async startMany(langs, scope) {
      const [first, ...rest] = langs;
      this.queue = rest;
      this.queueScope = scope;
      return this.start({ lang: first, scope });
    },
    async _advanceQueue() {
      if (!this.queue.length || this.job?.state === "running") return;
      const lang = this.queue.shift();
      try {
        await this.start({ lang, scope: this.queueScope || "pending" });
      } catch {
        this.queue = []; // a failed start must not strand a silent queue
      }
    },
    watch() {
      this.unwatch();
      try {
        const es = new EventSource(serverUrl("/v1/jobs/stream"));
        this._source = es;
        const update = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.job) this.job = data.job;
            else if (data.done !== undefined && this.job) {
              this.job = { ...this.job, done: data.done, total: data.total };
            }
            if (this.job?.total) this._task?.setProgress(this.job.done, this.job.total);
          } catch { /* keepalive */ }
        };
        for (const t of ["hello", "start", "progress", "done", "cancelling", "error"]) {
          es.addEventListener(t, update);
        }
        es.addEventListener("done", async () => {
          this.unwatch();
          await this.refresh();
          const state = this.job?.state;
          this._closeTask(state === "done" ? "done" : state === "cancelled" ? "cancelled" : "failed");
          this._advanceQueue();
        });
        es.onerror = () => { this.unwatch(); };
      } catch {
        // SSE unavailable — poll instead.
        const tick = async () => {
          await this.refresh();
          if (this.job && this.job.state === "running") setTimeout(tick, 1500);
        };
        tick();
      }
    },
    unwatch() {
      if (this._source) {
        this._source.close();
        this._source = null;
      }
    },
    async cancel() {
      this.queue = []; // cancelling means stop — never auto-start the next language
      const out = await post("/v1/jobs/cancel", {});
      this.job = out.job ?? this.job;
      this._closeTask("cancelled");
    },
    async proposals(lang) {
      return get(`/v1/proposals?lang=${encodeURIComponent(lang)}`);
    },
  },
});
