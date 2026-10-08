// SPDX-License-Identifier: MIT
// GET /v1/health — the boot-gate contract. The port of api/health_api.py.
//
// The kit's checkServer() pings /v1/health before main.js mounts the app; without this route
// every ping 404'd and the RELEASE webview showed ConnectionError forever — found 2026-08-04
// by the real-webview smoke against the real project (nothing else boots through main.js, so
// no other gate could see it).

import { API_VERSION, PRODUCT, VERSION } from "../version.js";

export async function router(app) {
  // The family base shape (camelCase wire): docgen carries no extras (JW adds dataDir/dbReady,
  // JV its engine block). checkServer() reads only the HTTP status.
  app.get("/v1/health", async () => ({ status: "ok", product: PRODUCT, version: VERSION, apiVersion: API_VERSION }));
}
