// SPDX-License-Identifier: MIT
// Unit-test harness (parity batch slice 11 — JW's vitest.config.js is the donor):
// default node environment; component/boot tests opt into jsdom per-file with a
// `@vitest-environment jsdom` docblock. Why this exists: the build compiles SFCs
// without resolving script identifiers and biome doesn't check .vue identifiers —
// a mount is the only gate that executes that code (the TDZ-crash class; JV's
// caught live 2026-08-05). The e2e suite (node --test over the real webview)
// stays the acceptance surface; this is the fast per-change gate.
// Run: npm run test:unit
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Quasar's browser build for a test with a DOM (jsdom — Vite's client environment), its server
// build for the rest: a bare `quasar` resolves by the "node" export condition to the SSR build,
// which refuses to install outside an SSR app (Quasar's own error: alias "quasar" to
// "quasar/dist/quasar.client.js" under jsdom), while the browser build reads `window` as it loads.
const quasarBuildPerEnvironment = {
  name: "quasar-build-per-environment",
  enforce: "pre",
  resolveId(id, importer, options) {
    if (id !== "quasar" || this.environment?.config?.consumer !== "client") return null;
    return this.resolve("quasar/dist/quasar.client.js", importer, { ...options, skipSelf: true });
  },
};

export default defineConfig({
  // transformAssetUrls off IN TESTS ONLY: a template's `/public-asset.svg` src
  // stays a URL string (vite dev/build behavior) instead of becoming a file
  // import node can't resolve (JV's boot smoke hit this on the splash logo).
  plugins: [quasarBuildPerEnvironment, vue({ template: { transformAssetUrls: false } })],
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src"),
      "@delebash/llm-ui": resolve(__dirname, "../just-llm-runner/ui/src"),
      // Quasar's wrappers (defineBoot / defineRouter / defineStore) — the alias Quasar's own
      // build makes for #q-app
      "#q-app": "@quasar/app-vite",
    },
    // Same dedupe list as quasar.config.js, same reason — keep the two in lock-step.
    dedupe: ["vue", "quasar", "reka-ui", "@floating-ui/dom", "pinia", "vue-router",
             "marked", "vue-sonner", "@vueuse/core", "@tanstack/vue-table"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
