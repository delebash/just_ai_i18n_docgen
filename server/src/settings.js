// SPDX-License-Identifier: MIT
// The app's own settings — one schema per key (app-structure §16), seeded with their first values, editable in
// Settings → General through /v1/settings, and a better default carried to an install that still holds the earlier
// one (the kit's upgradeSettings — the engines plan's F2). The template's schemas/settings.js, database/settings.js
// and seed.js settings part (2026-10-29), on docgen's own table: appmeta's app_settings rows (where the reviewer, the
// access tokens and the renderer's pref.* rows live too), each value JSON.

import { upgradeSettings as upgradeToToday } from "@delebash/core/platform";
import { getLogger } from "@delebash/core/platform/log";
import * as appmeta from "./appmeta.js";
import { SETTING_KEYS } from "./schemas/settings.js";

export { SETTING_KEYS, SETTINGS, SettingsPatch } from "./schemas/settings.js";

const log = getLogger("just_ai_i18n_docgen.settings");

/** The settings and their first values — each key has its schema above. */
export const SETTING_DEFAULTS = {
  "windows.checkSeconds": 3,
};

/**
 * The earlier defaults of the settings whose default has changed — each one's fingerprint (the kit's `fingerprint`:
 * the first 16 hex digits of the SHA-256 of its canonical JSON), per key. When a default in SETTING_DEFAULTS changes,
 * add the OUTGOING default's fingerprint here (tests/settings_upgrade.test.js holds today's and fails until you do):
 * an install still holding it — its owner never edited it — gets the new default.
 */
export const PREVIOUS_DEFAULTS = Object.freeze({});

/** A setting's value (JSON), or undefined when it has no row; an unreadable one reads as null, never a 500. */
export function getAppSetting(h, key) {
  const raw = appmeta.getSetting(key, h);
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Set a setting (its value as JSON). */
export function setAppSetting(h, key, value) {
  appmeta.setSetting(key, JSON.stringify(value), h);
}

/** `{key: value}` for those of `keys` that have a row. */
export function readSettings(h, keys = SETTING_KEYS) {
  const out = {};
  for (const key of keys) {
    const v = getAppSetting(h, key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Several settings in one transaction. */
export function writeSettings(h, values) {
  h.tx(() => {
    for (const [key, value] of Object.entries(values)) setAppSetting(h, key, value);
  });
}

/** Add every missing setting; returns how many were added. */
export function seedSettings(h) {
  let added = 0;
  h.tx(() => {
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      if (getAppSetting(h, key) === undefined) {
        setAppSetting(h, key, value);
        added += 1;
      }
    }
  });
  return added;
}

/** A setting still at an earlier default (PREVIOUS_DEFAULTS) takes today's; a value its owner changed is left alone
 *  (the kit's upgradeSettings). Returns the keys it upgraded. */
export function upgradeSettings(h) {
  const upgraded = upgradeToToday(h, { defaults: SETTING_DEFAULTS, previous: PREVIOUS_DEFAULTS, getSetting: getAppSetting, setSetting: setAppSetting });
  if (upgraded.length) log.info(`settings still at an earlier default, now today's: ${upgraded.join(", ")}`);
  return upgraded;
}
