// SPDX-License-Identifier: MIT
// Hash mode — the family standard (works from file:// in the Tauri webview and the
// server's static fallback alike). Home is the dashboard; Setup is a page you visit,
// never the front door (2026-08-02 redesign ruling).
import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: () => import("../views/HomeView.vue") },
    { path: "/setup", component: () => import("../views/SetupView.vue") },
    { path: "/review", component: () => import("../views/ReviewView.vue") },
    { path: "/runs", component: () => import("../views/RunsView.vue") },
    { path: "/docs", component: () => import("../views/DocsView.vue") },
  ],
});
