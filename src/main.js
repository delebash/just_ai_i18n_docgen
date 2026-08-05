// SPDX-License-Identifier: MIT
import { createApp } from "vue";
import { createPinia } from "pinia";
import { ConnectionError, checkServer, configureHelp, installLlmUi, serverUrl, startWarmOnBoot } from "@delebash/llm-ui";
import App from "./App.vue";
import { router } from "./router";
import { useUiStore } from "./stores/ui";
import { hasDoc, loadDoc, titleForSlug } from "./services/helpDocs.js";
import "./styles/tokens.css";
import "./styles/styles.css";

const pinia = createPinia();
const app = createApp(App).use(pinia).use(router);

// The whole shared LLM front end, in one call (the UI twin of the server's
// install_llm). It resolves ONE origin-aware base for both the app transport and the
// kit's LLM views — they used to be two calls, and the day they disagreed every kit
// view rendered EMPTY in the production webview only, because a bare configureLlmUi
// falls back to window.location.origin (= tauri.localhost there). It also wires the
// Tauri opener for external links and registers <LlmUiHosts />.
installLlmUi(app, {
  devPorts: ["1420"],
  fallbackBase: "http://127.0.0.1:8742",
  // The opener stays the APP's: `@tauri-apps/plugin-opener` is a Tauri dependency, and
  // importing it inside the kit breaks every non-Tauri consumer's build. Tauri's
  // webview swallows target=_blank, so without this every About/help link is dead —
  // the kit warns loudly in a webview when no opener is passed.
  external: async (url) => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  },
  // No embedding features here, and the catalog seeds translation-measured rows only.
  capabilities: { embeddings: false },
  // This app's voice on the shared model-catalog surface (the defaults are JW's words).
  catalogCopy: {
    chatSectionLabel: "Translation models",
    chatSectionHint: "measured on real localisation runs — pick one as your model",
    generalUse: "Translates your strings and checks its own work",
    slotsFootnote: "One model does everything here — it loads automatically on the first run; Load now just skips that first wait.",
  },
  // This app's voice on the shared Quick Setup wizard (the surgery 2026-08-04: the
  // 359-line fork died — the kit wizard + this voice + the shared cache-offer step
  // replace it; canon words live in the labels store, never here).
  quickSetupCopy: {
    bandSub: "A free local translation engine in one click — the models offered here are the ones MEASURED on real localisation runs, sized to this PC.",
    headSub: "A free local translation engine in one click — measured models, sized to this PC.",
    confirmTitle: "Local translation AI",
    modelHint: "Pick a model — best first: every one here was measured on real localisation runs rather than guessed at. One click installs the engine if it's missing, downloads the model, loads it, and makes it the model the Translate & Confirm presets run on.",
    chatRole: "translates your strings and checks its own work",
    doneBody: "Translate and Confirm run on this model — change it any time under Routing by feature.",
  },
});

// In-app Help (kit drawer over docs/*.md) — the minimal drawer-only shape: no
// full-pane reader route yet, so the open-full/open-web buttons stay hidden.
configureHelp({ loadDoc, hasDoc, titleForSlug });

useUiStore(pinia).boot(); // theme before first paint — no flash of the wrong mode

// Warm the default local model BEFORE mount (JW's mechanic, via the kit's
// startWarmOnBoot now): the splash overlay is up on the very first Vue paint — a
// seamless hand-off from index.html's static plate, never a shell flash between
// them. Only the decision + load kickoff is awaited; the load itself runs in the
// background and <BootModelLoad /> renders it.
(async () => {
  // Server unreachable → mount the kit ConnectionError INSTEAD of the app (JW's
  // pattern, family canon): the renderer holds no data of its own, so a dead server
  // breaks every view — rendering empty stores looks broken and silently fails.
  if (!(await checkServer())) {
    createApp(ConnectionError, {
      appName: "Just AI i18n & DocGen",
      serverUrl: serverUrl(""),
      need: "read your locale files and run translations",
      devHint: "Dev: start it with `npm run server` in the project root, then retry.",
    }).mount("#app");
    return;
  }
  await startWarmOnBoot();
  app.mount("#app");
})();
