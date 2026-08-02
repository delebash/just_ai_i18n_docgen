// SPDX-License-Identifier: MIT
// Hash mode — the family standard (works from file:// in the Tauri webview and the
// server's static fallback alike).
import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/review" },
    { path: "/setup", component: () => import("../views/SetupView.vue") },
    { path: "/review", component: () => import("../views/ReviewView.vue") },
    { path: "/runs", component: () => import("../views/RunsView.vue") },
  ],
});
