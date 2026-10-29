// SPDX-License-Identifier: MIT
// Just AI i18n & DocGen — the renderer's start-up, as a Quasar boot file (the kit's
// app-structure §Q.4). Quasar creates the app (root: App.vue), Pinia (stores/index.js) and the
// router (router/index.js), awaits this file, then installs the router and mounts. Until the
// Quasar move (2026-10-09) this was src/main.js, which created and mounted the app itself (or the
// connection-error screen as its own app); the start-up now decides by route — the app, or the
// connection-error page (/offline) — and the sequence below is unchanged. The stylesheets are quasar.config.js's `css`.
import { defineBoot } from "#q-app";
import { bootPrefs, checkServer, configureFileSave, configureHelp, configureTestData, installErrorReporting, installLlmUi, startWarmOnBoot, tooltipDirective, watchOtherWindows } from "@delebash/ui";
import { hasDoc, loadDoc, titleForSlug } from "../services/helpDocs.js";
import { LAB_TEST_ACTIONS, LAB_TEST_SOURCES } from "../services/labTestData.js";
import { hasShell, openPath, openUrl, saveFile, saveFromUrl } from "../services/native.js";
import { i18n } from "../i18n/index.js";
import { useUiStore } from "../stores/ui";

async function boot({ app, router, store: pinia }) {
  // The whole shared LLM front end, in one call (the UI twin of the server's
  // install_llm). It resolves ONE origin-aware base for both the app transport and the
  // kit's LLM views — they used to be two calls, and the day they disagreed every kit
  // view rendered EMPTY in the production webview only, because a bare configureLlmUi
  // falls back to window.location.origin. It also wires the desktop shell's openers for
  // external links and registers <LlmUiHosts />.
  installLlmUi(app, {
    // The kit's words in this app's language (i18n/index.js); this app's voice on the model
    // catalog and Quick Setup is its own `kit.catalog.*` / `kit.quickSetup.*` keys there.
    i18n,
    devPorts: ["1450"],
    fallbackBase: "http://127.0.0.1:8742",
    // The openers, through services/native.js (the shell's one bridge) — the SAME line in
    // all three apps. The kit decides when they can be used (browser vs desktop shell); no
    // app repeats that reasoning. `openPath` is what the model catalog's "Open folder" rides.
    external: { open: openUrl, openPath },
    // No embedding features here, and the catalog seeds translation-measured rows only.
    capabilities: { embeddings: false },
    // every request names this window (X-Client-Id): the server counts each window's changes apart, so the others'
    // pages read again (the kit's ChangeCounter; watchOtherWindows below)
    sendClientId: true,
  });

  // Renderer errors reach the server's log (app-structure §15): Vue's errorHandler and the window's
  // error / unhandledrejection post each failure to POST /v1/logs/client, and tell the user once per
  // distinct message — Settings → Logs shows them beside the server's lines.
  installErrorReporting(app);
  // the kit's tooltips (v-tooltip — the AI status button, the help button, the tables…), as the template registers it
  app.directive("tooltip", tooltipDirective);
  // Every file the app makes (Settings → Backups) goes through the kit's saveBlob: the shell's Save-as dialog in
  // the desktop app, a browser download elsewhere (app-structure §5, door 3) — the template's wiring.
  configureFileSave({
    save: (blob, { filename, title, filterName, filterExt, defaultDir }) =>
      saveFile({ blob, suggestedName: filename, title, filterName, filterExt, defaultDir }),
    saveUrl: (url, { filename, headers, title, filterName, filterExt, defaultDir }) =>
      saveFromUrl({ url, headers, suggestedName: filename, title, filterName, filterExt, defaultDir }),
    available: hasShell,
  });

  // The AI Lab's test input (§7.3, JustWrite's wiring): a picker over the project's languages that fills each
  // prompt row's variables from a live sample — what a real run of it sends (services/labTestData.js).
  configureTestData({ sources: LAB_TEST_SOURCES, actions: LAB_TEST_ACTIONS });

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
  // another window's changes on this server: the pages read again (a restore or a reset reloads the window)
  watchOtherWindows();
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
      el.textContent = i18n.global.t("app.couldNotStart", { error: e?.message || e });
    }
    throw e;
  }
});
