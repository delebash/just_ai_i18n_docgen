// SPDX-License-Identifier: MIT
// Settings → Backups' server half (data_admin.js over the kit's makeDataRouter) — the template's
// server/tests/data.test.js with docgen's rows: a backup is a ZIP of the database, a restore puts its
// rows back, a reset returns the first-run state — keeping the access tokens, so a reset never opens
// an exposed server; a restore keeps this server's tokens, never the backup's; and while a restore
// replaces the data, every other write is refused (the maintenance gate) after the runner stopped.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "@delebash/core/platform";
import { ZipReader, ZipWriter } from "@delebash/core/platform/zip";
import * as llmDb from "@delebash/core/llm/db";
import * as lifecycle from "@delebash/core/runner/lifecycle";
import { beforeEach, expect, test, vi } from "vitest";
import { createApp, seedLlmStack } from "../src/app.js";
import { deleteSetting, getSetting } from "../src/appmeta.js";
import { testClient, tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

let client;
beforeEach(async () => {
  client = testClient(await createApp(tmpDir()));
  // serve.js's own sequence: createApp, then the seed pass
  seedLlmStack();
});

const reviewer = async (headers = {}) => (await client.get("/v1/reviewer", { headers })).json().reviewer;
const tokens = () => JSON.parse(getSetting("auth") ?? "null")?.tokens;

/** POST /v1/data/restore with this ZIP, as the Backups panel sends it. */
function restore(zip, headers = {}) {
  const form = new FormData();
  form.append("file", new Blob([zip], { type: "application/zip" }), "backup.zip");
  return client.app.request(
    "http://testserver/v1/data/restore",
    { method: "POST", body: form, headers: { host: "testserver", ...headers } },
    { incoming: { socket: { remoteAddress: "192.0.2.10" } } },
  );
}

test("backup, change, restore: the backup's rows come back", async () => {
  await client.put("/v1/reviewer", { json: { reviewer: "Before the backup" } });
  const backup = await client.get("/v1/data/backup");
  expect(backup.statusCode).toBe(200);
  expect(backup.headers["content-type"]).toBe("application/zip");
  expect(backup.rawPayload.subarray(0, 2).toString()).toBe("PK");

  await client.put("/v1/reviewer", { json: { reviewer: "After the backup" } });
  expect(await reviewer()).toBe("After the backup");

  expect((await restore(backup.rawPayload)).status).toBe(200);
  expect(await reviewer()).toBe("Before the backup");
});

test("reset returns the first-run state but keeps the access tokens", async () => {
  await client.put("/v1/reviewer", { json: { reviewer: "Gone after reset" } });
  await client.patch("/v1/prefs", { json: { aiOfferShown: true } });
  await client.put("/v1/server-auth", { json: { tokens: ["still-here"] } });
  const auth = { headers: { authorization: "Bearer still-here" } };

  expect((await client.post("/v1/data/reset", auth)).statusCode).toBe(200);
  expect(await reviewer(auth.headers)).toBeNull();
  expect((await client.get("/v1/prefs", auth)).json()).toEqual({});
  expect(tokens()).toEqual(["still-here"]);
  // the AI stack was reseeded too
  expect((await client.get("/v1/llm-providers", auth)).json().providers.length).toBeGreaterThan(0);
});

test("a restore keeps this server's access tokens — never the backup's", async () => {
  // a backup from before a token was set: restored, the server stays closed with its own token
  const noToken = (await client.get("/v1/data/backup")).rawPayload;
  await client.put("/v1/server-auth", { json: { tokens: ["mine"] } });
  const auth = { authorization: "Bearer mine" };
  expect((await restore(noToken, auth)).status).toBe(200);
  expect(tokens()).toEqual(["mine"]);
  // a backup that carries a token (an older version's did — ours are scrubbed, below), restored on a server
  // without one: no token of the backup's comes with it
  const withToken = await rawBackup();
  deleteSetting("auth");
  expect((await restore(withToken)).status).toBe(200);
  expect(getSetting("auth")).toBeNull();
  // this version's backups carry no token at all
  await client.put("/v1/server-auth", { json: { tokens: ["mine"] } });
  const dir = tmpDir();
  writeFileSync(join(dir, "ours.zip"), (await client.get("/v1/data/backup", { headers: auth })).rawPayload);
  await (await ZipReader.open(join(dir, "ours.zip"))).extractAll(join(dir, "out"));
  const copy = openDatabase(join(dir, "out", "db.sqlite"), { foreignKeys: false });
  expect(getSetting("auth", copy)).toBeNull();
  copy.close();
});

/** A backup as an older version made it: the database as it is — its access tokens in it — zipped. */
async function rawBackup() {
  const dir = tmpDir();
  llmDb.session().run("VACUUM INTO ?", [join(dir, "db.sqlite")]);
  const zip = new ZipWriter();
  await zip.addFile(join(dir, "db.sqlite"), "db.sqlite");
  return Buffer.concat(zip.finish());
}

test("while a restore replaces the data the runner is stopped first and every other write is refused", async () => {
  const backup = (await client.get("/v1/data/backup")).rawPayload;
  // the runner's stop (beforeReplace) held open, so the restore stays mid-way with the gate closed
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  let stopping;
  const stopped = new Promise((r) => {
    stopping = r;
  });
  const stop = vi.spyOn(lifecycle.getService(), "stop").mockImplementation(async () => {
    stopping();
    await held;
  });
  const restoring = restore(backup);
  await stopped;
  const refused = await client.put("/v1/reviewer", { json: { reviewer: "During the restore" } });
  expect(refused.statusCode).toBe(503);
  expect(refused.headers["retry-after"]).toBeTruthy();
  release();
  expect((await restoring).status).toBe(200);
  expect(stop).toHaveBeenCalled();
  // open again once it's done
  expect((await client.put("/v1/reviewer", { json: { reviewer: "After the restore" } })).statusCode).toBe(200);
});

test("a restore of something that isn't a backup is refused", async () => {
  const r = await restore(Buffer.from("not a zip"));
  expect(r.status).toBe(400);
});
