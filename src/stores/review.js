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
    staged: [],          // /v1/proposals for this language — a run's unapplied output
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
        if (this.lang) await this.loadStaged(this.lang);
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
    // The staged pile for a language — what a run produced and nobody has accepted or
    // rejected yet. The queue only lists keys the CHECKS flagged, so a clean run's
    // proposals were reachable one key at a time or not at all; this is the list the
    // bulk actions work on.
    async loadStaged(lang = this.lang) {
      const body = await safeRequest(
        `/v1/proposals?lang=${encodeURIComponent(lang)}`, null);
      this.staged = body?.proposals ?? [];
      return this.staged;
    },
    // Apply EVERY staged proposal for the language in one call — the server writes them
    // as one action, so this stays one undo (workspace.py proposals_apply).
    async applyAllStaged(lang = this.lang) {
      const keys = (await this.loadStaged(lang)).map((p) => p.key);
      if (!keys.length) return { applied: [] };
      const out = await post("/v1/proposals/apply", { lang, keys });
      await this.refresh(lang); // reloads the queue AND the staged pile
      return out;
    },
    // Throw the pile away without writing anything (DELETE with no keys = all).
    async discardAllStaged(lang = this.lang) {
      const out = await del("/v1/proposals", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      await this.refresh(lang); // reloads the queue AND the staged pile
      return out;
    },
    async state() {
      return get("/v1/state");
    },
  },
});
