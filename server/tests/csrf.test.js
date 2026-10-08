// SPDX-License-Identifier: MIT
// Port of tests/test_csrf.py — the CSRF Origin guard (the kit's CsrfOriginMiddleware, wired
// in app.js): the no-token "do the vector directly" hardening.
//
// Assertions are framed as "the middleware did / did not block" (403 vs anything-else) so
// they stay true whatever the route itself answers about workspace state.
import { expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { testClient, tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

const client = async () => testClient(await createApp(tmpDir()));

test("cross_site_mutation_rejected", async () => {
  // A malicious page's cross-site mutating request is rejected (the CSRF vector) — before
  // routing, so the path's own semantics never matter.
  const c = await client();
  const r = await c.post("/v1/undo", { json: {}, headers: { origin: "http://evil.example" } });
  expect(r.statusCode).toBe(403);
  expect(r.json().type.endsWith("/cross-origin")).toBe(true);
});

test("no_origin_and_app_origin_allowed", async () => {
  const c = await client();
  // No Origin (the CLI / curl / tests) → not blocked by CSRF.
  expect((await c.post("/v1/undo", { json: {} })).statusCode).not.toBe(403);
  // The app's own dev origin (Vite :1450) → not blocked.
  expect((await c.post("/v1/undo", { json: {}, headers: { origin: "http://localhost:1450" } })).statusCode).not.toBe(403);
  // The desktop window's origin (the Electron shell's app://) → not blocked.
  expect((await c.post("/v1/undo", { json: {}, headers: { origin: "app://just-ai-i18n-docgen" } })).statusCode).not.toBe(403);
});

test("same_origin_mutation_allowed", async () => {
  // The server-hosted UI is same-origin, and browsers DO send Origin on same-origin mutations
  // (JW hit exactly that, 2026-07-15). Derived per-request, so any host/port works.
  const c = await client();
  const r = await c.post("/v1/undo", { json: {}, headers: { origin: "http://testserver" } });
  expect(r.statusCode).not.toBe(403);
});

test("cross_site_read_allowed", async () => {
  // GET is not the CSRF vector.
  const c = await client();
  const r = await c.get("/v1/health", { headers: { origin: "http://evil.example" } });
  expect(r.statusCode).toBe(200);
});
