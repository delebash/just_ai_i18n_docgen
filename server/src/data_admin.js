// SPDX-License-Identifier: MIT
// Settings → Backups' server half: the kit's backup / restore / reset router (makeDataRouter, the
// family's one implementation) over this app's database — the template's server/src/data_admin.js
// with docgen's tables. One database, two table sets — the app's (appmeta: the reviewer, the access
// tokens, the renderer's `pref.*` rows) and the shared LLM stack's — and no asset folders: the
// per-project text (config.json, <lang>.accepted.json, <lang>.notes.json) lives in the USER'S
// project, anchored to the config file, never under the data folder.
//
// Reset is the first-run state: the runner stops first (no model keeps running under settings that
// no longer exist), both table sets are dropped and created again — so a reset also recovers from
// schema drift (the family true-drop rule) — and the LLM seed runs. The access tokens survive it: a
// reset on an exposed headless server must not open it to the network. A restore replaces the rows
// under the running app, so the runner stops before it and after it (the clean-slate rule, JustWrite
// 2026-07-11) — and it keeps this server's access tokens, not the backup's (keepAuth).

import path from "node:path";
import { LLM_TABLES, seedLlm } from "@delebash/core/llm";
import * as llmDb from "@delebash/core/llm/db";
import { makeDataRouter } from "@delebash/core/platform";
import { sortedTables } from "@delebash/core/platform/data_api";
import { getLogger } from "@delebash/core/platform/log";
import * as lifecycle from "@delebash/core/runner/lifecycle";
import * as appmeta from "./appmeta.js";
import { APP_TABLES } from "./appmeta.js";

const log = getLogger("just_ai_i18n_docgen.data");

/** A restore keeps this server's access tokens, as a reset does: they are the server's, not the data's —
 *  a backup made before a token was set would open the server to the network, one with another token
 *  lock every client out. The kit's restore runs both inside its transaction. */
let keptAuth;
export const keepAuth = {
  beforeCopy: (h) => {
    keptAuth = appmeta.getSetting("auth", h);
  },
  afterCopy: (h) => {
    if (keptAuth === null) appmeta.deleteSetting("auth", h);
    else appmeta.setSetting("auth", keptAuth, h);
  },
  // and a backup carries none: a file shared or left somewhere never hands out a way in
  scrubBackup: (h) => appmeta.deleteSetting("auth", h),
};

async function stopRunnerBestEffort() {
  try {
    await lifecycle.getService().stop();
  } catch {
    // best-effort by design — a reset or restore never fails on the runner's teardown
  }
}

/** `metadata.drop_all` — every table of a captured list, children first. */
function dropTables(h, tables) {
  for (const t of [...sortedTables(tables)].reverse()) h.exec(`DROP TABLE IF EXISTS "${t}"`);
}

/** Back to the first-run state (POST /v1/data/reset). */
export async function resetWorkspace() {
  const h = llmDb.session(); // the one database installLlm and appmeta were given (app.js bootLlmStack)
  await stopRunnerBestEffort();
  const auth = appmeta.getSetting("auth");
  dropTables(h, APP_TABLES);
  dropTables(h, LLM_TABLES);
  h.createTables(APP_TABLES);
  h.createTables(LLM_TABLES);
  if (auth !== null) appmeta.setSetting("auth", auth);
  seedLlm();
  log.info("workspace reset to its first-run state");
}

export const router = (dataDir, { gate } = {}) =>
  makeDataRouter({
    getDbPath: () => path.join(dataDir, "app.db"),
    metadata: [APP_TABLES, LLM_TABLES],
    runReset: resetWorkspace,
    assetDirs: () => ({}),
    ...keepAuth,
    // what would write into the data being replaced stops before it is (the gate is closed by then), and what was
    // derived from the old data after
    beforeReplace: stopRunnerBestEffort,
    onReplaced: stopRunnerBestEffort,
    gate,
  });
