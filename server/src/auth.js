// SPDX-License-Identifier: MIT
// This app's auth SEAM — the settings read behind the family bearer-auth middleware (the
// kit's `BearerAuthMiddleware`, wired in app.js). The port of auth.py.
//
// The POLICY (token check, loopback bypass, the 2026-08-05 lockout escape) lives once in the
// kit. What stays here is the only genuinely per-app part: where this app keeps its auth
// config — appmeta's `auth` row (`{"tokens": [...], "requireForLoopback": bool}`), read per
// /v1 request so a change applies live.

import { getLogger } from "@delebash/llm-runner/platform/log";
import { errText, isDict, pyGet, truthy } from "@delebash/llm-runner/platform/py";
import { jsonLoadsExact } from "@delebash/llm-runner/platform/pyjson";
import * as appmeta from "./appmeta.js";
import { toPlain } from "./jsonio.js";

const log = getLogger("just_ai_i18n_docgen.auth");

/**
 * [tokens, requireForLoopback] from appmeta's `auth` row. Defaults to no auth on any read
 * error so a settings glitch can't lock the user out.
 */
export function readAuth() {
  try {
    const raw = appmeta.getSetting("auth");
    if (!raw) return [[], false];
    let cfg = toPlain(jsonLoadsExact(raw));
    if (!truthy(cfg)) cfg = {}; // `json.loads(raw) or {}`
    if (!isDict(cfg)) throw new Error(`'${Array.isArray(cfg) ? "list" : typeof cfg}' object has no attribute 'get'`);
    const tokens = pyGet(cfg, "tokens");
    const list = truthy(tokens) ? tokens : [];
    return [Array.from(list).filter((t) => typeof t === "string" && t), truthy(pyGet(cfg, "requireForLoopback"))];
  } catch (e) {
    // never let an auth-config read 500
    log.warning(`auth config read failed (treating as no-auth): ${errText(e)}`);
    return [[], false];
  }
}
