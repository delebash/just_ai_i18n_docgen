// SPDX-License-Identifier: MIT
// The routes. Hash mode — the family standard (works from app:// in the Electron window and the
// server's static fallback alike). Home is the dashboard; Setup is a page you visit, never the
// front door (2026-08-02 redesign ruling). /ai and /settings are the standard app chrome
// (2026-08-03): the kit's AI area and the sectioned settings.

// The layout is imported, not lazy-loaded: every screen needs it, so a chunk of its own would only
// delay the first paint, and its components' styles stay in the entry stylesheet — ahead of the
// app's, where the app's rules have always won a tie with them. The pages are lazy.
import MainLayout from "../layouts/MainLayout.vue";

const pageRoutes = [
  { path: "", component: () => import("../pages/HomePage.vue") },
  { path: "setup", component: () => import("../pages/SetupPage.vue") },
  { path: "review", component: () => import("../pages/ReviewPage.vue") },
  { path: "runs", component: () => import("../pages/RunsPage.vue") },
  { path: "docs", component: () => import("../pages/DocsPage.vue") },
  { path: "ai", component: () => import("../pages/AiPage.vue") },
  {
    path: "settings/:section?",
    component: () => import("../pages/SettingsPage.vue"),
    props: true,
  },
];

// The CLI's shape: every page inside the app's layout (layouts/MainLayout.vue — the title bar, the
// nav as Quasar's drawer, the content scroller), so their paths are relative to it; the
// connection-error page outside it (boot/docgen.js sends every route there while the server is
// down).
export default [
  { path: "/", component: MainLayout, children: pageRoutes },
  { path: "/offline", component: () => import("../pages/ConnectionErrorPage.vue") },
];
