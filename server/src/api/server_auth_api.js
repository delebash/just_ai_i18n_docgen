// SPDX-License-Identifier: MIT
// GET/PUT /v1/server-auth — the headless lock (Settings → Server). The port of
// api/server_auth_api.py.
//
// Bearer tokens gating /v1/* when the server runs exposed. Off (empty) by default;
// reading/writing this endpoint is itself gated once tokens exist — loopback stays exempt
// unless requireForLoopback is set, so the local user can never lock themselves out (the
// kit's bearerAuth leaves /v1/health and THIS route reachable from loopback — the lockout
// escape).

import { Hono, input } from "@delebash/core/platform";
import { RequestValidationError } from "@delebash/core/platform/errors";
import { getLogger } from "@delebash/core/platform/log";
import { pyJson } from "@delebash/core/platform/pyjson";
import { opt, strictObject, T } from "@delebash/core/platform/schema";
import * as appmeta from "../appmeta.js";
import { readAuth } from "../auth.js";

const log = getLogger("just_ai_i18n_docgen.server_auth");

/** The tokens and the switch — the template's limits (2026-10-29: docgen took any strings, padded ones too, which
 *  the guard then never matched). */
export const AuthIn = strictObject({
  tokens: T.Array(T.String({ maxLength: 200 }), { maxItems: 50 }),
  requireForLoopback: opt(T.Boolean(), false),
});

const TOKEN_CHARS = /^[!-~]+$/;

/** The tokens trimmed, the empty ones dropped; one with other characters refused in words, at its place. */
function cleanTokens(tokens) {
  const errors = [];
  const out = [];
  tokens.forEach((t, i) => {
    const v = t.trim();
    if (!v) return;
    if (TOKEN_CHARS.test(v)) out.push(v);
    else errors.push({ type: "value_error", loc: ["body", "tokens", i], msg: "A token takes letters, digits and the signs on a keyboard only — no spaces, accents or other characters" });
  });
  if (errors.length) throw new RequestValidationError(errors);
  return out;
}

export function router() {
  const app = new Hono();
  app.get("/v1/server-auth", async (c) => {
    const [tokens, require] = readAuth();
    return c.json({ tokens, requireForLoopback: require });
  });

  app.put("/v1/server-auth", input({ body: AuthIn }), async (c) => {
    const body = c.req.valid("json");
    const cfg = { tokens: cleanTokens(body.tokens), requireForLoopback: body.requireForLoopback };
    appmeta.setSetting("auth", pyJson(cfg));
    // how many, never which — a token is a secret (app-structure §15)
    log.info(`access tokens changed: ${cfg.tokens.length} set${cfg.requireForLoopback ? ", required on this machine too" : ""}`);
    return c.json(cfg);
  });
  return app;
}
