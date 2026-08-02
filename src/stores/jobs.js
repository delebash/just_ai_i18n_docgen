// SPDX-License-Identifier: MIT
// Runs — start (202), watch (SSE with polling fallback), cancel, history. A job stages
// PROPOSALS only; the review store's applyProposal is the human action that writes.
import { defineStore } from "pinia";
import { get, post, safeRequest, serverUrl } from "@delebash/llm-ui";

export const useJobsStore = defineStore("jobs", {
  state: () => ({
    job: null,
    runs: [],
    starting: false,
    error: "",
    _source: null,
  }),
  actions: {
    async refresh() {
      const cur = await safeRequest("/api/jobs/current", null);
      this.job = cur?.job ?? null;
      const hist = await safeRequest("/api/runs", null);
      this.runs = hist?.runs ?? [];
    },
    async start({ lang, scope, keys = null, presetId = null }) {
      this.error = "";
      this.starting = true;
      try {
        const out = await post("/api/jobs", { lang, scope, keys, presetId });
        this.job = out.job;
        this.watch();
        return out;
      } catch (e) {
        this.error = e?.message || String(e);
        throw e;
      } finally {
        this.starting = false;
      }
    },
    watch() {
      this.unwatch();
      try {
        const es = new EventSource(serverUrl("/api/jobs/stream"));
        this._source = es;
        const update = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.job) this.job = data.job;
            else if (data.done !== undefined && this.job) {
              this.job = { ...this.job, done: data.done, total: data.total };
            }
          } catch { /* keepalive */ }
        };
        for (const t of ["hello", "start", "progress", "done", "cancelling", "error"]) {
          es.addEventListener(t, update);
        }
        es.addEventListener("done", () => { this.unwatch(); this.refresh(); });
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
      const out = await post("/api/jobs/cancel", {});
      this.job = out.job ?? this.job;
    },
    async proposals(lang) {
      return get(`/api/proposals?lang=${encodeURIComponent(lang)}`);
    },
  },
});
