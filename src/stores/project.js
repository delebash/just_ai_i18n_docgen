// SPDX-License-Identifier: MIT
// Setup + project identity. `refresh` asks /v1/setup/state (works with NO project —
// that is the whole point of the setup screen).
import { defineStore } from "pinia";
import { get, post, put, safeRequest } from "@delebash/ui";
import { i18n } from "../i18n/index.js";

export const useProjectStore = defineStore("project", {
  state: () => ({
    loaded: false,
    configPath: null,
    source: null,
    langs: [],
    context: "",
    glossary: [],
    reviewer: null,
    languages: [],
    inspect: null,      // the last /v1/setup/inspect result
    saving: false,
    summary: null,      // /v1/summary — the dashboard's per-language counts
    noProject: false,   // CONFIRMED 409 (needsSetup) — only then is the welcome honest
    serverDown: false,  // unreachable ≠ no project
  }),
  getters: {
    // "myapp" out of …/myapp/just-ai-help/config.json — the project's human name.
    appName: (s) => {
      const parts = (s.configPath || "").split(/[\\/]/).filter(Boolean);
      return parts.length >= 3 ? parts[parts.length - 3] : i18n.global.t("app.yourApp");
    },
  },
  actions: {
    async refresh() {
      const s = await safeRequest("/v1/setup/state", null);
      if (!s) return;
      Object.assign(this, {
        loaded: s.loaded, configPath: s.configPath, source: s.source,
        langs: s.langs, context: s.context, glossary: s.glossary,
        reviewer: s.reviewer, languages: s.languages,
      });
    },
    async fetchSummary() {
      // Three honest states (user, 3rd report 2026-08-03: Home stuck on the welcome
      // because null meant BOTH "no project" and "server still starting"): a
      // CONFIRMED 409/needsSetup shows the welcome; anything else is serverDown and
      // gets the connection screen + retries — never a lying welcome.
      try {
        this.summary = await get("/v1/summary");
        this.noProject = false;
        this.serverDown = false;
      } catch (e) {
        this.summary = null;
        // the server's problem+json: its needs-setup 409 carries the member (app-structure §15; the transport puts
        // the status and the problem on the Error)
        this.noProject = e?.status === 409 && e?.problem?.needsSetup === true;
        this.serverDown = !this.noProject;
      }
      return this.summary;
    },
    // a path the server can't use is a 422 under `path` — the page shows it under the box (fieldErrors)
    async inspectPath(path) {
      try {
        this.inspect = await post("/v1/setup/inspect", { path });
      } catch (e) {
        this.inspect = null;
        throw e;
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
