// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// THE BOOT SMOKE (parity batch slice 11) — the skeleton (stub environment +
// mount assertion + why this gate exists: the TDZ-crash class) is the kit's
// registerBootSmoke; this file keeps the app's parts: the fetch route map and
// the boot-error probe. The REAL webview stays the acceptance surface (npm run
// screenshots); this is the fast per-change gate.
//
// The start-up is Quasar's (the kit's app-structure §Q.4): the root App.vue, Pinia from
// stores/index.js, the router from router/index.js, the boot file awaited, then the router
// installed and the app mounted — the steps Quasar's generated client entry takes, run here by
// hand because that entry only exists inside a Quasar build.
import { registerBootSmoke } from "@delebash/llm-ui/test/bootSmoke.js";

registerBootSmoke({
  boot: async () => {
    const { createApp } = await import("vue");
    const { default: App } = await import("./App.vue");
    const { default: createStore } = await import("./stores/index.js");
    const { default: createRouter } = await import("./router/index.js");
    const { default: docgenBoot } = await import("./boot/docgen.js");
    const app = createApp(App);
    const store = await createStore({});
    app.use(store);
    const router = await createRouter({ store });
    await docgenBoot({ app, router, store });
    app.use(router);
    app.mount("#app");
  },
  routes: {
    "/v1/health": { status: "ok", product: "just-ai-i18n-docgen" },
    "/v1/prefs": {}, // the prefs DOCUMENT is the top-level object (empty = defaults)
    // the dashboard's summary, in the server's shape (server/src/api/workspace_api.js /v1/summary):
    // since the Quasar move the boot resolves the first route before mount, so Home renders here
    "/v1/summary": { source: "en", keyCount: 0, configPath: "i18n.json", langs: [], job: null },
  },
  // boot() surfaces failures on window.__bootErr — rethrow so the waitFor loop
  // fails fast with the real error instead of timing out.
  ready: () => {
    if (window.__bootErr) throw window.__bootErr;
  },
});
