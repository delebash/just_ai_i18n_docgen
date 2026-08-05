// SPDX-License-Identifier: MIT
// The review queue — rows from /v1/rows, mutations through the endpoints that carry
// the design's promises (bulk accept = one undo; unaccept can revisit; save re-checks).
//
// Batch 3 (2026-08-05): the ORIGINAL's workspace shape ported whole — buckets with
// live counts, a per-check breakdown, search, keyboard-driven selection (move), the
// identical-bucket pick set, and the Accepted surface (the audit's "unaccept is a
// guaranteed no-op": accepted rows never reach the queue, so a surface must LIST
// them). Detail source: just-ai-help client/src/stores/review.js.
import { defineStore } from "pinia";
import { del, get, post, put, safeRequest } from "@delebash/llm-ui";

/** Bucket definitions for the queue. `match` decides which rows a bucket contains. */
export const BUCKETS = [
  { id: "needs", label: "Needs review", match: (r) => r.flags.some((f) => !f.advisory) },
  { id: "unsure", label: "Unsure", match: (r) => r.flags.some((f) => f.code === "disagreement") },
  { id: "terminology", label: "Terminology", match: (r) => r.flags.some((f) => f.code === "terminology") },
  { id: "missing", label: "Missing", match: (r) => r.flags.some((f) => f.code === "missing") },
  { id: "identical", label: "Came back identical", match: (r) => r.flags.some((f) => f.code === "untranslated") },
  { id: "proposals", label: "Proposed", match: (r) => r.hasProposal },
  { id: "all", label: "All flagged", match: () => true },
];

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
    bucket: "needs",     // the original's default: the non-advisory pile first
    code: null,          // a specific check code within the bucket
    search: "",
    picked: [],          // keys ticked in the identical bucket (bulk approve)
    acceptedEntries: [], // /v1/accepted — the Accepted surface (unaccept lives here)
  }),
  getters: {
    activeRow: (s) => s.rows.find((r) => r.key === s.activeKey) || null,
    /** The rows the list actually shows, after bucket, code and search. */
    visible: (s) => {
      const b = BUCKETS.find((x) => x.id === s.bucket) ?? BUCKETS.at(-1);
      const q = s.search.trim().toLowerCase();
      return s.rows.filter((r) => {
        if (!b.match(r)) return false;
        if (s.code && !r.flags.some((f) => f.code === s.code)) return false;
        if (!q) return true;
        return r.key.toLowerCase().includes(q)
          || (r.source || "").toLowerCase().includes(q)
          || (r.target || "").toLowerCase().includes(q);
      });
    },
    bucketCounts: (s) =>
      Object.fromEntries(BUCKETS.map((b) => [b.id, s.rows.filter((r) => b.match(r)).length])),
    pickedRows() {
      return this.visible.filter((r) => this.picked.includes(r.key));
    },
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
        this.picked = this.picked.filter((k) => this.rows.some((r) => r.key === k));
        if (this.lang) await this.loadStaged(this.lang);
        if (this.bucket === "accepted") await this.loadAccepted();
        // Keep the selection if it survived; otherwise take the first visible row,
        // so the panel is never blank while there is work (the original's rule).
        if (!this.activeRow || !this.visible.includes(this.activeRow)) {
          await this.open(this.visible[0]?.key ?? null);
        }
      } finally {
        this.loading = false;
      }
    },
    pickBucket(id) {
      this.bucket = id;
      this.code = null;
      if (id === "accepted") {
        this.loadAccepted();
      } else {
        this.open(this.visible[0]?.key ?? null);
      }
    },
    pickCode(c) {
      this.code = this.code === c ? null : c;
      this.open(this.visible[0]?.key ?? null);
    },
    /** Moves the selection by `delta` within the visible list — the j/k path. */
    move(delta) {
      const list = this.visible;
      if (!list.length) return;
      const i = list.findIndex((r) => r.key === this.activeKey);
      const next = list[Math.min(list.length - 1, Math.max(0, (i === -1 ? 0 : i) + delta))];
      this.open(next?.key ?? null);
    },
    isPicked(key) {
      return this.picked.includes(key);
    },
    togglePick(key) {
      this.picked = this.isPicked(key)
        ? this.picked.filter((k) => k !== key)
        : [...this.picked, key];
    },
    /** Ticks or clears every VISIBLE row — select-all respects the current filter. */
    pickAll(on) {
      this.picked = on ? this.visible.map((r) => r.key) : [];
    },
    /** Pre-ticks what the engine judged correct as-is — a SUGGESTED selection only. */
    pickConfirmed() {
      this.picked = this.visible
        .filter((r) => r.flags.some((f) => f.confirmed === "same"))
        .map((r) => r.key);
    },
    async acceptPicked() {
      const keys = this.pickedRows.map((r) => r.key);
      if (!keys.length) return { recorded: 0 };
      const out = await post("/v1/accept", { lang: this.lang, keys });
      this.picked = [];
      await this.refresh();
      return out;
    },
    async loadAccepted(lang = this.lang) {
      const body = await safeRequest(
        `/v1/accepted?lang=${encodeURIComponent(lang)}`, null);
      this.acceptedEntries = body?.entries ?? [];
      return this.acceptedEntries;
    },
    async open(key) {
      this.activeKey = key;
      if (key === null) {
        this.detail = null;
        return;
      }
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
      if (this.bucket === "accepted") await this.loadAccepted();
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
    async discardProposal(row) {
      await del("/v1/proposals", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: row.lang, keys: [row.key] }),
      });
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
