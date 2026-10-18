// SPDX-License-Identifier: MIT
// GET /v1/health — the boot-gate contract, through the kit's shared router (app-structure §14).
//
// The kit's checkServer() pings /v1/health before the boot file (src/boot/docgen.js) lets the
// app mount; without this route every ping 404'd and the RELEASE webview showed ConnectionError
// forever — found 2026-08-04 by the real-webview smoke against the real project (nothing else
// boots through the boot file, so no other gate could see it). docgen carries no extras.

import { makeHealthRouter } from "@delebash/core/platform";
import { API_VERSION, PRODUCT, VERSION } from "../version.js";

export function router() {
  return makeHealthRouter({ product: PRODUCT, version: VERSION, apiVersion: API_VERSION });
}
