// SPDX-License-Identifier: MIT
// Port of tests/test_app.py — the app factory, proven working from a fresh data dir.
//
// Same hermeticity rules as the kit's own install_llm test (helpers.useHermeticKit): the
// runner singleton reset, a file-backed SQLite database (createApp makes its own in the temp
// data dir), and both routers mounted. This test doubles as the adoption proof.
//
// `lockout_escape_…`: Python patched the kit's `_is_loopback` to say yes; the JS sends the
// request from 127.0.0.1 instead (the kit's hook calls isLoopback directly, so a spy can't
// reach it — and a real loopback address is the honest version anyway).
import { getLogger } from "@delebash/llm-runner/platform/log";
import { pyPath } from "@delebash/llm-runner/runner/cache_registry";
import * as lifecycle from "@delebash/llm-runner/runner/lifecycle";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { createApp, FEATURE_CATALOG, seedLlmStack } from "../src/app.js";
import { testClient, tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

let client;
let dataDir;
beforeEach(async () => {
  dataDir = tmpDir();
  const app = await createApp(dataDir);
  // The serve-time boot this file proves: createApp + the explicit seed (serve.js's exact
  // sequence — the family call-site).
  seedLlmStack();
  client = testClient(app);
});

test("the_stack_boots_seeded_and_wired", async () => {
  const providers = await client.get("/v1/llm-providers");
  expect(providers.statusCode).toBe(200);
  expect(providers.json().providers.length, "seedLlm should have seeded providers").toBeGreaterThan(0);

  const models = await client.get("/v1/llm-runner/models");
  expect(models.statusCode).toBe(200);
  const body = models.json();
  expect(body.catalogWired).toBe(true);
  expect(body.models.length, "the seeded model catalog reaches the runner").toBeGreaterThan(0);

  expect((await client.get("/v1/ai-usage")).statusCode).toBe(200);
});

test("the_three_routed_features_are_registered", async () => {
  // Extract left the catalog 2026-08-04: it never calls the engine (pure front-matter
  // parsing), and a routing row that cannot route is a lie.
  const routing = await client.get("/v1/ai/routing");
  expect(routing.statusCode).toBe(200);
  const keys = new Set((routing.json().features || []).map((f) => f.key));
  expect(keys).toEqual(new Set(FEATURE_CATALOG.map((f) => f.key)));
  expect(keys).toEqual(new Set(["translate", "review", "confirm"]));
});

test("the_runner_cache_lands_in_the_app_data_dir", () => {
  // The delete-the-app-delete-the-weights guarantee: dataDir was passed, so the runner's cache
  // root is inside it, not in ~/.cache.
  expect(String(lifecycle.getService().cacheRoot)).toBe(pyPath(join(dataDir, "ai-cache")));
});

test("logs_ring_captures_and_serves_server_logs", async () => {
  // The Settings → Logs viewer's contract: a log line written through the log module lands in
  // the shared ring and comes back over /v1/logs/tail — content, not just a 200.
  getLogger("just_ai_i18n_docgen.test").warning("RING-PROOF abc123");
  const r = await client.get("/v1/logs/tail");
  expect(r.statusCode).toBe(200);
  expect(r.json().text).toContain("RING-PROOF abc123");
});

test("disk_usage_reports_the_data_dir", async () => {
  const r = await client.get("/v1/disk/usage");
  expect(r.statusCode).toBe(200);
  expect(r.body.includes("totalBytes") || Object.keys(r.json()).length > 0, "the shared disk route must answer with usage").toBe(true);
});

test("health_answers_the_boot_gate", async () => {
  // The kit's checkServer() pings /v1/health before main.js mounts the app. Without this route
  // every RELEASE boot showed ConnectionError forever (found 2026-08-04 by the real-webview
  // smoke; nothing else boots through main.js, so this test is the only cheap tripwire).
  const r = await client.get("/v1/health");
  expect(r.statusCode).toBe(200);
  const body = r.json();
  // The family base shape (camelCase wire).
  expect(body.status).toBe("ok");
  expect(body.product && body.version && body.apiVersion).toBeTruthy();
});

test("bearer_auth_gates_v1_only_when_tokens_exist", async () => {
  // The headless lock: no tokens → open; tokens set → /v1 needs the bearer (the test
  // client's address is not loopback, so the gate bites), UI assets stay open.
  expect((await client.get("/v1/setup/state")).statusCode).toBe(200); // off by default

  const r = await client.put("/v1/server-auth", { json: { tokens: ["s3cret"] } });
  expect(r.statusCode).toBe(200);
  try {
    expect((await client.get("/v1/setup/state")).statusCode, "no header → 401").toBe(401);
    expect((await client.get("/v1/setup/state", { headers: { authorization: "Bearer wrong" } })).statusCode, "bad token → 403").toBe(403);
    expect((await client.get("/v1/setup/state", { headers: { authorization: "Bearer s3cret" } })).statusCode, "good token → through").toBe(200);
  } finally {
    // Clear through the gate (with the token) so later requests stay unauthenticated.
    await client.put("/v1/server-auth", { json: { tokens: [] }, headers: { authorization: "Bearer s3cret" } });
  }
  expect((await client.get("/v1/setup/state")).statusCode).toBe(200);
});

test("lockout_escape_health_and_auth_door_stay_open_from_loopback", async () => {
  // audit 2026-08-05: requireForLoopback + a lost token gated even /v1/health (the desktop's
  // boot gate died on ConnectionError FOREVER) and /v1/server-auth (the very door to fix it).
  // From the machine itself both stay open; everything else stays gated.
  const local = (method, url, json) =>
    client.app.inject({ method, url, remoteAddress: "127.0.0.1", ...(json !== undefined ? { payload: json } : {}) });
  await local("PUT", "/v1/server-auth", { tokens: ["s3cret"], requireForLoopback: true });
  try {
    expect((await local("GET", "/v1/health")).statusCode, "the boot probe never locks").toBe(200);
    expect((await local("GET", "/v1/server-auth")).statusCode, "the fix-it door never locks").toBe(200);
    expect((await local("GET", "/v1/setup/state")).statusCode, "the rest stays gated").toBe(401);
  } finally {
    await local("PUT", "/v1/server-auth", { tokens: [] });
  }
  expect((await local("GET", "/v1/setup/state")).statusCode).toBe(200);
});

test("a_browser_origin_gets_cors_headers", async () => {
  // Vite dev (:1450) hits :8742 DIRECTLY (the kit's origin-aware resolver), so without CORS
  // every browser dev request dies as a silent block. Found live 2026-08-02 — only an explicit
  // Origin header can make a test see it.
  const r = await client.get("/v1/setup/state", { headers: { origin: "http://localhost:1450" } });
  expect(r.statusCode).toBe(200);
  expect(r.headers["access-control-allow-origin"]).toBe("*");
});
