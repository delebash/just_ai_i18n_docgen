// SPDX-License-Identifier: MIT
// The review queue — rows from /v1/rows, mutations through the endpoints that carry
// the design's promises (bulk accept = one undo; unaccept can revisit; save re-checks).
import { defineStore } from "pinia";
import { del, get, post, put, safeRequest } from "@delebash/llm-ui";

export const useReviewStore = defineStore("review", {
  state: () => ({
    rows: [],
    counts: {},
    accepted: 0,
    total: 0,
    lang: null,
    loading: false,
    activeKey: null,
    detail: null,        // { siblings, reference } for the active key
  }),
  getters: {
    activeRow: (s) => s.rows.find((r) => r.key === s.activeKey) || null,
  },
  actions: {
    async refresh(lang = this.lang) {
      this.loading = true;
      try {
        const body = await safeRequest(
          lang ? `/v1/rows?lang=${encodeURIComponent(lang)}` : "/v1/rows", null);
        if (!body) return;
        this.rows = body.rows;
        this.counts = body.counts;
        this.accepted = body.accepted;
        this.total = body.total;
        this.lang = lang || body.langs[0] || null;
      } finally {
        this.loading = false;
      }
    },
    async open(key) {
      this.activeKey = key;
      const row = this.activeRow;
      if (!row) return;
      this.detail = { siblings: [], reference: null, english: null };
      const sib = await safeRequest(
        `/v1/siblings?lang=${row.lang}&key=${encodeURIComponent(key)}`, null);
      if (sib && this.activeKey === key) this.detail.siblings = sib.siblings;
    },
    async save(row, value) {
      const out = await post("/v1/save", { lang: row.lang, key: row.key, value });
      await this.refresh();
      return out;
    },
    async accept(row) {
      await post("/v1/accept", { lang: row.lang, keys: [row.key] });
      await this.refresh();
    },
    async acceptMany(lang, keys) {
      const out = await post("/v1/accept", { lang, keys });
      await this.refresh();
      return out;
    },
    async unaccept(lang, key) {
      await del("/v1/accept", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, key }),
      });
      await this.refresh();
    },
    async undo() {
      await post("/v1/undo", {});
      await this.refresh();
    },
    async setNote(row, note) {
      await put("/v1/notes", { lang: row.lang, key: row.key, note });
      await this.refresh();
    },
    async backtranslate(row) {
      const out = await post("/v1/backtranslate", { lang: row.lang, key: row.key });
      if (this.detail && this.activeKey === row.key) this.detail.english = out.english;
      return out;
    },
    async applyProposal(row) {
      await post("/v1/proposals/apply", { lang: row.lang, keys: [row.key] });
      await this.refresh();
    },
    async state() {
      return get("/v1/state");
    },
  },
});
