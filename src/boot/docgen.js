// SPDX-License-Identifier: MIT
// Just AI i18n & DocGen — the renderer's start-up, as a Quasar boot file (the kit's
// app-structure §Q.4). Quasar creates the app (root: App.vue), Pinia (stores/index.js) and the
// router (router/index.js), awaits this file, then installs the router and mounts. Until the
// Quasar move (2026-10-09) this was src/main.js, which created and mounted the app itself (or the
// connection-error screen as its own app); the start-up now decides by route — the app, or the
// connection-error page (/offline) — and the sequence below is unchanged. The stylesheets are quasar.config.js's `css`.
import { defineBoot } from "#q-app";
import { bootPrefs, checkServer, configureHelp, installLlmUi, startWarmOnBoot } from "@delebash/llm-ui";
import { hasDoc, loadDoc, titleForSlug } from "../services/helpDocs.js";
import { openPath, openUrl } from "../services/native.js";
import { useUiStore } from "../stores/ui";

async function boot({ app, router, store: pinia }) {
  // The whole shared LLM front end, in one call (the UI twin of the server's
  // install_llm). It resolves ONE origin-aware base for both the app transport and the
  // kit's LLM views — they used to be two calls, and the day they disagreed every kit
  // view rendered EMPTY in the production webview only, because a bare configureLlmUi
  // falls back to window.location.origin. It also wires the desktop shell's openers for
  // external links and registers <LlmUiHosts />.
  installLlmUi(app, {
    devPorts: ["1450"],
    fallbackBase: "http://127.0.0.1:8742",
    // The openers, through services/native.js (the shell's one bridge) — the SAME line in
    // all three apps. The kit decides when they can be used (browser vs desktop shell); no
    // app repeats that reasoning. `openPath` is what the model catalog's "Open folder" rides.
    external: { open: openUrl, openPath },
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

  // In-app Help (kit drawer over docs/*.md) — the minimal drawer-only shape: no
  // full-pane reader route yet, so the open-full/open-web buttons stay hidden.
  configureHelp({ loadDoc, hasDoc, titleForSlug });

  // Server unreachable → the kit's ConnectionError INSTEAD of the app (JW's pattern, family
  // canon): the renderer holds no data of its own, so a dead server breaks every view —
  // rendering empty stores looks broken and silently fails. Every route goes to the
  // connection-error page (pages/ConnectionErrorPage.vue, outside the layout); its Retry
  // reloads the window, and once the server answers /offline goes back to the page it came from.
  if (!(await checkServer())) {
    router.beforeEach((to) => (to.path === "/offline" ? true : { path: "/offline", query: { from: to.fullPath } }));
    return;
  }
  router.beforeEach((to) => (to.path === "/offline" ? to.query.from || "/" : true));
  // Prefs before the ui store's FIRST init (its state reads them), theme before mount — the
  // static plate covers this await, so still no flash of the wrong mode (target-tree P9: prefs
  // are server-backed now).
  await bootPrefs();
  useUiStore(pinia).boot();
  // Warm the default local model BEFORE mount (JW's mechanic, via the kit's startWarmOnBoot):
  // the splash overlay is up on the very first Vue paint — a seamless hand-off from
  // index.html's static plate. Only the decision + load kickoff is awaited; the load itself
  // runs in the background and <BootModelLoad /> renders it.
  await startWarmOnBoot();
  // Resolve the initial (lazy) route before mount so the first paint is the real view. Quasar
  // installs the router only after this file, and isReady() waits on the navigation that
  // installing starts — so the boot makes that first navigation itself.
  await router.replace(router.options.history.location);
}

export default defineBoot(async (ctx) => {
  try {
    await boot(ctx);
  } catch (e) {
    // Boot must NEVER strand the static splash plate (found 2026-08-05: a dead server left the
    // plate on screen forever with nothing mounted). Whatever threw, tear the plate down and
    // say so in place — Quasar mounts nothing after a boot error.
    window.__bootErr = e;
    document.getElementById("app-boot")?.remove();
    const el = document.getElementById("q-app");
    if (el && !el.childElementCount) {
      el.textContent = `The app could not start: ${e?.message || e}`;
    }
    throw e;
  }
});
