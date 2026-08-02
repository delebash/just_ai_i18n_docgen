// SPDX-License-Identifier: MIT
import { createApp } from "vue";
import { createPinia } from "pinia";
import { configureLlmUi, configureServerApi, makeOriginAwareResolver } from "@delebash/llm-ui";
import App from "./App.vue";
import { router } from "./router";
import { useUiStore } from "./stores/ui";
import "./styles/tokens.css";
import "./styles/styles.css";

// One transport, origin-aware — the family pattern. In Vite dev (:1420) relative URLs
// ride the dev proxy to :8742; in the Tauri webview the resolver falls back to the
// sidecar's loopback address; served headless from the Python server, same-origin wins.
configureServerApi({
  resolveBase: makeOriginAwareResolver({ devPorts: ["1420"], fallback: "http://127.0.0.1:8742" }),
});
configureLlmUi({});

const pinia = createPinia();
const app = createApp(App).use(pinia).use(router);
useUiStore(pinia).boot(); // theme before first paint — no flash of the wrong mode
app.mount("#app");
