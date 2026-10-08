// SPDX-License-Identifier: MIT
// Captured 2026-10-08 by the kit's capture-schema tool from the Python server's tables, and
// since then the schema itself (the Python is gone): each table's DDL is the exact text
// Python's create_all wrote to sqlite_master, so old and new databases match cell for cell;
// `columns` carries each column's conversion kind and default. Change a table here.
export const TABLES = [
  {
    "name": "app_settings",
    "ddl": "CREATE TABLE app_settings (\n\t\"key\" VARCHAR NOT NULL, \n\tvalue VARCHAR, \n\tPRIMARY KEY (\"key\")\n)",
    "indexes": [],
    "columns": {
      "key": {
        "kind": "text",
        "pk": true,
        "notNull": true
      },
      "value": {
        "kind": "text"
      }
    }
  }
];
