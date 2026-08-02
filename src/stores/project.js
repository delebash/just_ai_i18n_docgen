// SPDX-License-Identifier: MIT
// Setup + project identity. `refresh` asks /v1/setup/state (works with NO project —
// that is the whole point of the setup screen).
import { defineStore } from "pinia";
import { post, put, safeRequest } from "@delebash/llm-ui";

export const useProjectStore = defineStore("project", {
  state: () => ({
    loaded: false,
    configPath: null,
    source: null,
    langs: [],
    reviewer: null,
    languages: [],
    inspect: null,      // the last /v1/setup/inspect result
    inspectError: "",
    saving: false,
  }),
  actions: {
    async refresh() {
      const s = await safeRequest("/v1/setup/state", null);
      if (!s) return;
      Object.assign(this, {
        loaded: s.loaded, configPath: s.configPath, source: s.source,
        langs: s.langs, reviewer: s.reviewer, languages: s.languages,
      });
    },
    async inspectPath(path) {
      this.inspectError = "";
      try {
        this.inspect = await post("/v1/setup/inspect", { path });
      } catch (e) {
        this.inspect = null;
        this.inspectError = e?.message || String(e);
      }
      return this.inspect;
    },
    async save({ path, targets, context, glossary }) {
      this.saving = true;
      try {
        const out = await post("/v1/setup/save", { path, targets, context, glossary });
        await this.refresh();
        return out;
      } finally {
        this.saving = false;
      }
    },
    async setReviewer(name) {
      const out = await put("/v1/reviewer", { reviewer: name || null });
      this.reviewer = out.reviewer;
    },
  },
});
