// SPDX-License-Identifier: MIT
// Port of tests/test_app.py — the app factory, proven working from a fresh data dir.
//
// Same hermeticity rules as the kit's own install_llm test (helpers.useHermeticKit): the
// runner singleton reset, a file-backed SQLite database (createApp makes its own in the temp
// data dir), and both routers mounted. This test doubles as the adoption proof.
//
// `lockout_escape_…`: Python patched the kit's `_is_loopback` to say yes; the JS sends the
// request from 127.0.0.1 instead (the kit's middleware calls isLoopback directly, so a spy can't
// reach it — and a real loopback address is the honest version anyway).
import * as llmDb from "@delebash/core/llm/db";
import { getLogger } from "@delebash/core/platform/log";
import { pyPath } from "@delebash/core/runner/cache_registry";
import * as lifecycle from "@delebash/core/runner/lifecycle";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { createApp, FEATURE_CATALOG, MODEL_CATALOG, MODEL_CATALOG_HEALS, seedLlmStack } from "../src/app.js";
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

test("a_catalog_row_still_holding_its_old_seeded_text_gets_the_measured_one", () => {
  // The 12B row said "NOT yet measured" until 2026-10-29; an install seeded then gets the measured text at its next
  // start (the kit's modelCatalogHeals), and a text its owner wrote is never touched.
  const h = llmDb.session();
  const row12b = () => h.get("model_catalog", "gemma-4-12b-qat");
  const seeded = MODEL_CATALOG.find((r) => r.id === "gemma-4-12b-qat");
  const [oldDescription] = MODEL_CATALOG_HEALS["gemma-4-12b-qat"].description;
  const [oldNotes] = MODEL_CATALOG_HEALS["gemma-4-12b-qat"].notes;
  h.update("model_catalog", { description: oldDescription, notes: oldNotes }, { id: "gemma-4-12b-qat" });
  seedLlmStack();
  expect(row12b().description).toBe(seeded.description);
  expect(row12b().notes).toBe(seeded.notes);
  expect(row12b().description).toContain("MEASURED");

  h.update("model_catalog", { description: "my own words" }, { id: "gemma-4-12b-qat" });
  seedLlmStack();
  expect(row12b().description).toBe("my own words");
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
  // The kit's checkServer() pings /v1/health before the boot file lets the app mount. Without this route
  // every RELEASE boot showed ConnectionError forever (found 2026-08-04 by the real-webview
  // smoke; nothing else boots through the boot file, so this test is the only cheap tripwire).
  const r = await client.get("/v1/health");
  expect(r.statusCode).toBe(200);
  const body = r.json();
  // The family base shape (camelCase wire).
  expect(body.status).toBe("ok");
  expect(body.product && body.version && body.apiVersion).toBeTruthy();
  // where the data is (the release's start check compares the window's with the launcher's)
  expect(body.dataDir).toBe(dataDir);
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

test("a_token_is_kept_trimmed_and_one_with_other_characters_is_refused_in_words", async () => {
  // the template's rules (2026-10-29): a token pasted with a space at its end was stored as it came
  // and never matched what a client sends
  const r = await client.put("/v1/server-auth", { json: { tokens: ["  pasted-token \n", ""] } });
  expect(r.json().tokens).toEqual(["pasted-token"]);
  try {
    expect((await client.get("/v1/setup/state", { headers: { authorization: "Bearer pasted-token" } })).statusCode).toBe(200);
    const bad = await client.put("/v1/server-auth", { json: { tokens: ["has a space"] }, headers: { authorization: "Bearer pasted-token" } });
    expect(bad.statusCode).toBe(422);
    expect(JSON.stringify(bad.json())).toContain("no spaces, accents");
    const many = await client.put("/v1/server-auth", { json: { tokens: Array.from({ length: 51 }, (_, i) => `t${i}`) }, headers: { authorization: "Bearer pasted-token" } });
    expect(many.statusCode).toBe(422);
  } finally {
    await client.put("/v1/server-auth", { json: { tokens: [] }, headers: { authorization: "Bearer pasted-token" } });
  }
});

test("lockout_escape_health_and_auth_door_stay_open_from_loopback", async () => {
  // audit 2026-08-05: requireForLoopback + a lost token gated even /v1/health (the desktop's
  // boot gate died on ConnectionError FOREVER) and /v1/server-auth (the very door to fix it).
  // From the machine itself both stay open; everything else stays gated.
  const local = (method, url, json) =>
    client.app.request(
      url,
      { method, ...(json !== undefined ? { body: JSON.stringify(json), headers: { "content-type": "application/json" } } : {}) },
      { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
    );
  await local("PUT", "/v1/server-auth", { tokens: ["s3cret"], requireForLoopback: true });
  try {
    expect((await local("GET", "/v1/health")).status, "the boot probe never locks").toBe(200);
    expect((await local("GET", "/v1/server-auth")).status, "the fix-it door never locks").toBe(200);
    expect((await local("GET", "/v1/setup/state")).status, "the rest stays gated").toBe(401);
  } finally {
    await local("PUT", "/v1/server-auth", { tokens: [] });
  }
  expect((await local("GET", "/v1/setup/state")).status).toBe(200);
});

test("a_browser_origin_gets_cors_headers", async () => {
  // Vite dev (:1450) and the desktop window hit :8742 DIRECTLY (the kit's origin-aware
  // resolver), so without CORS every browser request dies as a silent block. Found live
  // 2026-08-02 — only an explicit Origin header can make a test see it.
  for (const origin of ["http://localhost:1450", "app://just-ai-i18n-docgen"]) {
    const r = await client.get("/v1/setup/state", { headers: { origin } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(origin); // its own origin, never every origin
  }
  // any other web page the user opened can't read this computer's server (the template's app.js)
  const evil = await client.get("/v1/data/backup", { headers: { origin: "https://evil.example" } });
  expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
});

test("the_headless_ui_is_the_kits_serveUi", async () => {
  // The built UI for a browser at this address (the kit's serveUi): the page with a validator,
  // Vite's hashed files kept, a write to the UI's address 405 naming what it takes, and an unknown
  // /v1 write the API's own 404 — not the UI's 405.
  const ui = tmpDir();
  mkdirSync(join(ui, "assets"));
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>docgen</title>");
  writeFileSync(join(ui, "assets", "index-abc123.js"), "export {};");
  vi.stubEnv("JUST_AI_I18N_DOCGEN_UI_DIR", ui);
  const c = testClient(await createApp(tmpDir()));
  const page = await c.get("/");
  expect(page.statusCode).toBe(200);
  expect(page.headers["content-type"]).toMatch(/text\/html/);
  expect(page.headers.etag).toBeTruthy();
  expect(page.headers["cache-control"]).toBe("no-cache");
  expect((await c.get("/assets/index-abc123.js")).headers["cache-control"]).toMatch(/immutable/);
  const write = await c.post("/index.html", { json: {} });
  expect(write.statusCode).toBe(405);
  expect(write.headers.allow).toBe("GET, HEAD");
  expect((await c.post("/v1/nothing-here", { json: {} })).statusCode).toBe(404);
});

test("a_cross_site_read_is_refused_unless_it_comes_from_the_apps_own_window", async () => {
  // the template's resourceIsolation (2026-10-29): a cross-site <img> of /v1/data/backup made backups
  const crossSite = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" };
  expect((await client.get("/v1/data/backup", { headers: crossSite })).statusCode).toBe(403);
  // the desktop window fetches its server cross-site, with its Origin
  const fromWindow = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", origin: "app://just-ai-i18n-docgen" };
  expect((await client.get("/v1/health", { headers: fromWindow })).statusCode).toBe(200);
  // no Fetch Metadata at all (curl, another program) passes as before
  expect((await client.get("/v1/health")).statusCode).toBe(200);
});

test("the_shutdown_route_answers_only_this_machine", async () => {
  // the desktop shell's clean stop (src-electron shutdownPath): from elsewhere it is refused
  expect((await client.post("/v1/shutdown", { json: {} })).statusCode).toBe(403);
  // from this machine, with no running server registered (a test), it says it isn't exiting
  const res = await client.app.request("http://127.0.0.1:8742/v1/shutdown", { method: "POST", headers: { host: "127.0.0.1:8742" } }, {
    incoming: { socket: { remoteAddress: "127.0.0.1" } },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, exiting: false });
});

test("the_google_frame_is_the_one_page_the_window_may_frame", async () => {
  // Review's Google second opinion: an <iframe> over GET /v1/gt-frame from the desktop window (cross-site, no
  // Origin). Named in resourceIsolation's framePaths; framing anything else stays refused.
  const frame = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" };
  const ok = await client.get("/v1/gt-frame", { params: { text: "Save", tl: "es" }, headers: frame });
  expect(ok.statusCode).toBe(200);
  expect(ok.body).toContain("google_translate_element");
  expect((await client.get("/v1/data/backup", { headers: frame })).statusCode).toBe(403);
});
