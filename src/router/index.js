// SPDX-License-Identifier: MIT
// Vue Router — hash history (the desktop window's app:// pages have no server for real paths),
// lazy-loaded views (routes.js). ONE router instance: Quasar installs it (the default export, the
// kit's app-structure §Q.1) and modules that navigate imperatively import it.
import { defineRouter } from "#q-app";
import { createMemoryHistory, createRouter, createWebHashHistory, createWebHistory } from "vue-router";
import routes from "./routes.js";

// The router as Quasar's CLI creates it — the history from quasar.config.js (`build.vueRouterMode`,
// always 'hash' here) — as ONE instance the modules that navigate import.
const createHistory = import.meta.env.QUASAR_SERVER
  ? createMemoryHistory
  : import.meta.env.QUASAR_VUE_ROUTER_MODE === "history"
    ? createWebHistory
    : createWebHashHistory;

export const router = createRouter({
  scrollBehavior: () => ({ left: 0, top: 0 }),
  routes,
  history: createHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE),
});

export default defineRouter(() => router);
