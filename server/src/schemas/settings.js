// SPDX-License-Identifier: MIT
// The app's settings — one schema per key (app-structure §16). A key is an app_settings row seeded with its first
// value (settings.js SETTING_DEFAULTS); /v1/settings reads and writes only the keys listed here, and Settings →
// General builds its form rules from the same schemas. Browser-safe: this file imports only the kit's
// `platform/schema` (TypeBox) — the renderer imports it through the server package (the template's shape).

import { opt, strictObject, T } from "@delebash/core/platform/schema";

export const SETTINGS = {
  // How often a window looks for what other windows changed on this server, in seconds (the kit's GET /v1/sync/rev
  // `pollSeconds`).
  "windows.checkSeconds": T.Integer({ minimum: 1, maximum: 60 }),
};

export const SETTING_KEYS = Object.keys(SETTINGS);

/** PATCH /v1/settings — any of the keys, nothing else. */
export const SettingsPatch = strictObject(Object.fromEntries(SETTING_KEYS.map((k) => [k, opt(SETTINGS[k])])));
