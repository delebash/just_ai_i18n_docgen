// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// THE BOOT SMOKE (parity batch slice 11) — the skeleton (stub environment +
// mount assertion + why this gate exists: the TDZ-crash class) is the kit's
// registerBootSmoke; this file keeps the app's parts: the fetch route map and
// the boot-error probe. The REAL webview stays the acceptance surface (npm run
// screenshots); this is the fast per-change gate.
import { registerBootSmoke } from "@delebash/llm-ui/test/bootSmoke.js";

registerBootSmoke({
  boot: () => import("./main.js"),
  routes: {
    "/v1/health": { status: "ok", product: "just-ai-i18n-docgen" },
    "/v1/prefs": { prefs: {} },
  },
  // boot() surfaces failures on window.__bootErr — rethrow so the waitFor loop
  // fails fast with the real error instead of timing out.
  ready: () => {
    if (window.__bootErr) throw window.__bootErr;
  },
});
