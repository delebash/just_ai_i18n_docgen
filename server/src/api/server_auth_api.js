// SPDX-License-Identifier: MIT
// GET/PUT /v1/server-auth — the headless lock (Settings → Server). The port of
// api/server_auth_api.py.
//
// Bearer tokens gating /v1/* when the server runs exposed. Off (empty) by default;
// reading/writing this endpoint is itself gated once tokens exist — loopback stays exempt
// unless requireForLoopback is set, so the local user can never lock themselves out (the
// kit's BearerAuthMiddleware leaves /v1/health and THIS route reachable from loopback — the
// lockout escape).

import { HttpError } from "@delebash/llm-runner/platform/errors";
import { T } from "@delebash/llm-runner/platform/models";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import * as appmeta from "../appmeta.js";
import { readAuth } from "../auth.js";
import { dget, pyStrip, pyTruthy } from "../jsonio.js";

/** FastAPI's `body: dict`. */
export const BODY = T.Record(T.String(), T.Any());

export async function router(app) {
  app.get("/v1/server-auth", async () => {
    const [tokens, require] = readAuth();
    return { tokens, requireForLoopback: require };
  });

  app.put("/v1/server-auth", { schema: { body: BODY } }, async (req) => {
    const body = req.body;
    const tokens = dget(body, "tokens");
    if (!Array.isArray(tokens) || !tokens.every((t) => typeof t === "string")) {
      throw new HttpError(400, "tokens must be a list of strings");
    }
    const cfg = { tokens: tokens.filter((t) => pyStrip(t)), requireForLoopback: pyTruthy(dget(body, "requireForLoopback")) };
    appmeta.setSetting("auth", pyJson(cfg));
    return cfg;
  });
}
