// SPDX-License-Identifier: MIT
// Unit-test harness (parity batch slice 11 — JW's vitest.config.js is the donor):
// default node environment; component/boot tests opt into jsdom per-file with a
// `@vitest-environment jsdom` docblock. Why this exists: build:vite compiles SFCs
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

export default defineConfig({
  // transformAssetUrls off IN TESTS ONLY: a template's `/public-asset.svg` src
  // stays a URL string (vite dev/build behavior) instead of becoming a file
  // import node can't resolve (JV's boot smoke hit this on the splash logo).
  plugins: [vue({ template: { transformAssetUrls: false } })],
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src"),
      "@delebash/llm-ui": resolve(__dirname, "../just-llm-runner/ui/src"),
    },
    // Same dedupe list as vite.config.js, same reason — keep the two in lock-step.
    dedupe: ["vue", "reka-ui", "@floating-ui/dom", "pinia", "vue-router",
             "marked", "vue-sonner", "@vueuse/core", "@tanstack/vue-table"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
