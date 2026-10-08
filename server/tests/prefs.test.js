// SPDX-License-Identifier: MIT
// Port of tests/test_prefs.py — /v1/prefs, the family renderer-prefs door.
//
// Pins docgen's storage mapping: `pref.*` rows in app_settings behind the kit router — the
// document round-trips, PATCH is wholesale per key, DELETE drops prefs but never the reviewer
// row (operator config in the same table).
import { expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { getReviewer, setReviewer } from "../src/appmeta.js";
import { testClient, tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

const c = async () => testClient(await createApp(tmpDir()));

test("document_round_trips", async () => {
  const client = await c();
  expect((await client.get("/v1/prefs")).json()).toEqual({});
  const merged = (
    await client.patch("/v1/prefs", { json: { appearance: { appearance: { mode: "dark" } }, keepServerRunning: true } })
  ).json();
  expect(merged).toEqual({ appearance: { appearance: { mode: "dark" } }, keepServerRunning: true });
  expect((await client.get("/v1/prefs")).json()).toEqual(merged);
});

test("patch_is_wholesale_per_key", async () => {
  const client = await c();
  await client.patch("/v1/prefs", { json: { appearance: { appearance: { mode: "dark", hue: 200 } } } });
  await client.patch("/v1/prefs", { json: { appearance: { appearance: { mode: "light" } } } });
  expect((await client.get("/v1/prefs")).json().appearance).toEqual({ appearance: { mode: "light" } });
});

test("delete_clears_prefs_but_never_the_reviewer", async () => {
  const client = await c();
  setReviewer("dana");
  await client.patch("/v1/prefs", { json: { aiOfferShown: true } });
  expect((await client.delete("/v1/prefs")).statusCode).toBe(204);
  expect((await client.get("/v1/prefs")).json()).toEqual({});
  expect(getReviewer()).toBe("dana");
});
