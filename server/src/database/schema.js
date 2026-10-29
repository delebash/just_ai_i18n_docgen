// SPDX-License-Identifier: MIT
// docgen's own tables, as numbered migrations (app-structure §16; the template's server/src/database/schema.js). The
// kit's `migrate` keeps the version in SQLite's own counter (PRAGMA user_version) and runs each newer migration once,
// in one transaction with the counter; a database newer than the code is refused. Newest last; an applied migration
// is never edited — a schema change is a new entry. The shared LLM stack's tables ride the same database: installLlm
// creates them.
//
// Version 1 ADOPTS the one table docgen has had since its Python days (2026-10-29): every data folder before then has
// it at version 0, so the migration creates it only when missing, from its captured DDL (appmeta_schema.js) — an
// existing table is kept cell for cell, a new database gets the same one.

import { TABLES } from "../appmeta_schema.js";

export const MIGRATIONS = [
  {
    version: 1,
    name: "app_settings (the reviewer, the access tokens, the settings, the renderer's prefs)",
    up: (db) => db.createTables(TABLES),
  },
];

/** The app's tables, for the kit's backup/restore/reset (makeDataRouter's `metadata`). */
export const APP_TABLES = TABLES;
