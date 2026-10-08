// SPDX-License-Identifier: MIT
// App-owned settings — the host's OWN domain table. The port of appmeta.py.
//
// The family pattern (the kit's llm/db.js documents it): the shared stack owns the LLM tables;
// the host has its own domain tables on the same database. Two kinds of rows live here:
//
// - Machine-level facts, one so far: the REVIEWER's name — asked for once, stamped on every
//   acceptance, so a verdict can say who made it. Never the OS username: an automated run
//   under a developer's account would inherit it and become indistinguishable from that
//   developer's judgement, which is the exact failure the field exists to expose.
// - Renderer prefs: `pref.<key>` rows, JSON-encoded, behind the kit's `/v1/prefs` router —
//   appearance and the ui flags ride `app.db` (and therefore the shared /v1/data
//   backup/restore/reset). The prefs clear drops only `pref.*` rows — the reviewer is
//   operator config and stays.
//
// The table's DDL is generated from Python's AppBase (appmeta_schema.js, the kit's
// capture-schema.py) so a new database is byte-for-byte what Python creates.

import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { TABLES } from "./appmeta_schema.js";

export { TABLES as APP_TABLES };

let handle = null;

/** Called once from createApp, with the same database handle installLlm uses — one database,
 * two table sets, the documented pattern. Creates the table when missing. */
export function configureAppStorage(h) {
  handle = h;
  h.createTables(TABLES);
}

function session() {
  if (!handle) throw new Error("app storage not configured — call configureAppStorage() during boot");
  return handle;
}

export function getSetting(key) {
  const row = session().get("app_settings", key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  const h = session();
  h.tx(() => {
    if (h.get("app_settings", key) === null) h.insert("app_settings", { key, value });
    else h.update("app_settings", { value }, { key });
  });
}

export const getReviewer = () => getSetting("reviewer");
export const setReviewer = (name) => setSetting("reviewer", name);

// ── Renderer prefs (the kit /v1/prefs hooks) — `pref.<key>` rows, JSON values ──

const PREF_PREFIX = "pref.";

// SQLAlchemy's `key.like("pref.%")` — the same SQL (LIKE is case-insensitive for ASCII in
// SQLite, and no ORDER BY: rowid order, as Python read it).
const PREF_WHERE = "key LIKE ?";
const PREF_LIKE = `${PREF_PREFIX}%`;

export function prefsReadAll() {
  const out = {};
  for (const row of session().all(`select * from app_settings where ${PREF_WHERE}`, [PREF_LIKE], "app_settings")) {
    let v;
    try {
      v = JSON.parse(row.value);
    } catch {
      v = null; // a None or unreadable value reads back as null
    }
    out[row.key.slice(PREF_PREFIX.length)] = v;
  }
  return out;
}

export function prefsWriteMany(patch) {
  const h = session();
  h.tx(() => {
    for (const [key, value] of Object.entries(patch)) {
      const rowKey = PREF_PREFIX + key;
      const encoded = pyJson(value); // json.dumps(value): ", " / ": " and \uXXXX, as Python stored it
      if (h.get("app_settings", rowKey) === null) h.insert("app_settings", { key: rowKey, value: encoded });
      else h.update("app_settings", { value: encoded }, { key: rowKey });
    }
  });
}

export function prefsClear() {
  session().run(`delete from app_settings where ${PREF_WHERE}`, [PREF_LIKE]);
}
