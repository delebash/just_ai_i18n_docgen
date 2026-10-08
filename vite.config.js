import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],
  resolve: {
    alias: {
      // The family renderer alias (target-tree P10): relative imports within a
      // directory, `@renderer/...` across the tree — JW's documented convention.
      "@renderer": resolve(__dirname, "src"),
      // The shared Vue kit — consumed as SOURCE via the sibling clone, the
      // family pattern (peer deps live in this package.json).
      "@delebash/llm-ui": resolve(__dirname, "../just-llm-runner/ui/src"),
    },
    // The aliased kit imports peer deps by bare specifier from its own dir; dedupe
    // forces a SINGLE copy from this app's node_modules (Reka provide/inject + Vue
    // reactivity break with two instances) — JW's exact fix, carried over.
    dedupe: ["vue", "reka-ui", "@floating-ui/dom", "pinia", "vue-router",
             "marked", "vue-sonner", "@vueuse/core", "@tanstack/vue-table"],
  },

  clearScreen: false,
  // A fixed port: `npm run dev` points the desktop window at it (scripts/dev.js).
  // 1450/1451 (target-tree P10): each family app owns its dev-port pair —
  // JW 1420 · JV 1430/1431 · this app 1450/1451. With strictPort a collision fails loudly
  // instead of leaving the window pointed at the OTHER app's dev server.
  server: {
    port: 1450,
    strictPort: true,
    fs: {
      // the kit lives outside this repo root
      allow: [resolve(__dirname), resolve(__dirname, "../just-llm-runner/ui")],
    },
    // NO /v1 proxy: nothing requests a relative /v1 — the kit's origin-aware
    // resolver builds ABSOLUTE URLs to :8742 from dev (CLAUDE.md "what bites":
    // CORS is the load-bearing mechanism, §6). A proxy here sat dead since the
    // rewrite and made the config claim a wire that never existed (audit
    // 2026-08-05 s2; the standard's §3 snippet carried the same stale line).
    watch: {
      // The trees JW/JV also guard: the server, the data folder, e2e, dist. The vite root
      // is the repo, so anything unlisted lands in chokidar's watch path — JV measured the
      // cost of an unguarded server tree at 500 ms → 6.2 s to first HTML (its config's
      // comment). Found by the 2026-08-05 s2 three-app audit.
      ignored: ["**/server/**", "**/data/**", "**/.venv/**", "**/e2e/**", "**/dist/**"],
    },
  },
  build: {
    // JW's build shape (target-tree P10). The desktop window is Electron's own Chromium
    // (152 in Electron 44) on every OS, so one modern target keeps esbuild from
    // down-leveling; the headless UI is opened in a current browser.
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "chrome140",
  },
}));
