import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],
  resolve: {
    alias: {
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

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    fs: {
      // the kit lives outside this repo root
      allow: [resolve(__dirname), resolve(__dirname, "../just-llm-runner/ui")],
    },
    proxy: {
      // dev: the Python server on the family port
      "/api": "http://127.0.0.1:8742",
      "/v1": "http://127.0.0.1:8742",
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
