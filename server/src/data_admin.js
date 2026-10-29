// SPDX-License-Identifier: MIT
// Settings → Backups' server half: the kit's backup / restore / reset router (makeDataRouter, the
// family's one implementation) over this app's database — the template's server/src/data_admin.js
// with docgen's tables. One database, two table sets — the app's (appmeta: the reviewer, the access
// tokens, the renderer's `pref.*` rows) and the shared LLM stack's — and no asset folders: the
// per-project text (config.json, <lang>.accepted.json, <lang>.notes.json) lives in the USER'S
// project, anchored to the config file, never under the data folder.
//
// Reset is the first-run state: a running translation is cancelled and the runner stops first (no
// model keeps running under settings that no longer exist), both table sets are dropped and created
// again — so a reset also recovers from schema drift (the family true-drop rule) — and the LLM seed
// runs. The access tokens survive it: a reset on an exposed headless server must not open it to the
// network. A restore replaces the rows under the running app, so a running translation is cancelled
// and the runner stops before it, and the runner after it (the clean-slate rule, JustWrite
// 2026-07-11) — and it keeps this server's access tokens, not the backup's (keepAuth).

import path from "node:path";
import { LLM_TABLES, seedLlm } from "@delebash/core/llm";
import * as llmDb from "@delebash/core/llm/db";
import { makeDataRouter } from "@delebash/core/platform";
import { sortedTables } from "@delebash/core/platform/data_api";
import { getLogger } from "@delebash/core/platform/log";
import * as lifecycle from "@delebash/core/runner/lifecycle";
// (app.js mounts this router; its seed is called only when a restore runs, so the two modules' cycle never matters)
import { seedLlmStack } from "./app.js";
import { getState } from "./app_state.js";
import * as appmeta from "./appmeta.js";
import { APP_TABLES } from "./appmeta.js";
import { seedSettings } from "./settings.js";

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

/** Cancel the running translation and wait for it to end (its staged proposals stay — they are the project's,
 *  never the data folder's), then let the runner go: a restore replaces the presets and the engine under a run,
 *  a reset deletes them (house-paint's teardown, the kit's JobRegistry.cancelAll — round D2). Best effort, as
 *  the runner's stop: a reset or restore never fails on its teardown. */
async function teardown() {
  try {
    await getState().jobs.cancelAll();
  } catch {
    // no app state yet, or nothing to cancel
  }
  await stopRunnerBestEffort();
}

/** `metadata.drop_all` — every table of a captured list, children first. */
function dropTables(h, tables) {
  for (const t of [...sortedTables(tables)].reverse()) h.exec(`DROP TABLE IF EXISTS "${t}"`);
}

/** Back to the first-run state (POST /v1/data/reset). */
export async function resetWorkspace() {
  const h = llmDb.session(); // the one database installLlm and appmeta were given (app.js bootLlmStack)
  // (the data router calls beforeReplace for a restore only — a reset runs this alone)
  await teardown();
  const auth = appmeta.getSetting("auth");
  dropTables(h, APP_TABLES);
  dropTables(h, LLM_TABLES);
  // the app's tables from their migrations again (the template's recreateAppTables), the stack's from its DDL
  h.raw.pragma("user_version = 0");
  appmeta.migrateAppTables(h);
  h.createTables(LLM_TABLES);
  if (auth !== null) appmeta.setSetting("auth", auth);
  seedLlm();
  seedSettings(h);
  // the data's new epoch: every other window reloads (the kit's ChangeCounter)
  getState().changes?.renewEpoch(h);
  getState().changes?.replaced();
  log.info("workspace reset to its first-run state");
}

export const router = (dataDir, { gate } = {}) =>
  makeDataRouter({
    getDbPath: () => path.join(dataDir, "app.db"),
    metadata: [APP_TABLES, LLM_TABLES],
    runReset: resetWorkspace,
    assetDirs: () => ({}),
    ...keepAuth,
    // and the data's new epoch, in the same transaction as the restored rows (the backup's own row replaced)
    afterCopy: (h) => {
      keepAuth.afterCopy(h);
      getState().changes?.renewEpoch(h);
    },
    // a backup from an older version gets what this one's seed adds and upgrades, as at start (the template's
    // seedWorkspace): the prompt rows a backup from before 2026-10-29 lacks, the presets, the catalog, the settings
    afterTables: () => seedLlmStack(),
    // what would write into the data being replaced stops before it is (the gate is closed by then), and what was
    // derived from the old data after; every window reloads — only once the data has been replaced
    beforeReplace: teardown,
    onReplaced: async () => {
      getState().changes?.replaced();
      await stopRunnerBestEffort();
    },
    gate,
  });
