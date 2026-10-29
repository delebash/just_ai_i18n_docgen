// SPDX-License-Identifier: MIT
// docgen's database on the family's way (app-structure §16, 2026-10-29): foreign keys on, its own table brought up by
// the kit's migrations — a data folder from before (its table at user_version 0, the user's rows in it) is adopted as
// it is, a database newer than this code is refused, and a reset runs the migrations again.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as llmDb from "@delebash/core/llm/db";
import { openDatabase } from "@delebash/core/platform";
import { expect, test } from "vitest";
import { createApp, seedLlmStack } from "../src/app.js";
import { TABLES } from "../src/appmeta_schema.js";
import { testClient, tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

const pragma = (name) => llmDb.session().raw.pragma(name, { simple: true });

test("a new data folder: foreign keys on, its table at the newest migration", async () => {
  await createApp(tmpDir());
  expect(pragma("foreign_keys")).toBe(1);
  expect(pragma("user_version")).toBe(1);
  expect(llmDb.session().raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").get()).toBeTruthy();
});

test("a data folder from before the migrations keeps its rows, and moves to version 1", async () => {
  const dataDir = tmpDir();
  mkdirSync(dataDir, { recursive: true });
  // the database every docgen until 2026-10-29 made: the captured table, user_version 0, the user's reviewer in it
  const old = openDatabase(join(dataDir, "app.db"), { foreignKeys: false });
  old.createTables(TABLES);
  old.insert("app_settings", { key: "reviewer", value: "Ana" });
  expect(old.raw.pragma("user_version", { simple: true })).toBe(0);
  old.close();

  const client = testClient(await createApp(dataDir));
  expect(pragma("user_version")).toBe(1);
  expect((await client.get("/v1/reviewer")).json().reviewer).toBe("Ana");
});

test("a database newer than this code is refused, never written", async () => {
  const dataDir = tmpDir();
  mkdirSync(dataDir, { recursive: true });
  const newer = openDatabase(join(dataDir, "app.db"), { foreignKeys: false });
  newer.raw.pragma("user_version = 99");
  newer.close();
  await expect(createApp(dataDir)).rejects.toThrow(/newer than this app knows/);
});

test("a reset runs the migrations again", async () => {
  const client = testClient(await createApp(tmpDir()));
  seedLlmStack();
  await client.put("/v1/reviewer", { json: { reviewer: "Ana" } });
  expect((await client.post("/v1/data/reset")).statusCode).toBe(200);
  expect(pragma("user_version")).toBe(1);
  expect(pragma("foreign_keys")).toBe(1);
  expect((await client.get("/v1/reviewer")).json().reviewer).toBeNull();
});
