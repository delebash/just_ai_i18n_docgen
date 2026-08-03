// SPDX-License-Identifier: MIT
import { createApp } from "vue";
import { createPinia } from "pinia";
import {
  configureExternal, configureLlmUi, configureServerApi, makeOriginAwareResolver,
} from "@delebash/llm-ui";
import App from "./App.vue";
import { router } from "./router";
import { useUiStore } from "./stores/ui";
import "./styles/tokens.css";
import "./styles/styles.css";

// One transport, origin-aware — the family pattern. In Vite dev (:1420) relative URLs
// ride the dev proxy to :8742; in the Tauri webview the resolver falls back to the
// sidecar's loopback address; served headless from the Python server, same-origin wins.
const resolveBase = makeOriginAwareResolver({ devPorts: ["1420"], fallback: "http://127.0.0.1:8742" });
configureServerApi({ resolveBase });
// The kit's LLM views need the SAME resolved base (JW parity: configureLlmUi with no
// baseUrl falls back to window.location.origin — which in the production webview is
// tauri.localhost, so every /v1/llm-* call 404'd into empty lists. Found 2026-08-03
// by the harness screenshots; invisible in dev, where origin-with-proxy happens to work).
configureLlmUi({ baseUrl: resolveBase() });
// External links: Tauri's webview swallows _blank, so kit anchors route through the
// opener plugin in the desktop app (JW parity — its About/help links were dead here
// until this was wired); plain browsers fall back to window.open inside the kit.
configureExternal({
  open: async (url) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
});

const pinia = createPinia();
const app = createApp(App).use(pinia).use(router);
useUiStore(pinia).boot(); // theme before first paint — no flash of the wrong mode
app.mount("#app");
