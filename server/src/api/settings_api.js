// SPDX-License-Identifier: MIT
// /v1/settings — the app's own settings, one schema per key (app-structure §16; the keys, their schemas and their
// first values: settings.js). The renderer's preferences are /v1/prefs, a different door. The template's route.
//
//   GET   /v1/settings  → {key: value} for every known key that has a row
//   PATCH /v1/settings  SettingsPatch → the same document | 422 (a value out of range, a key that isn't a setting)

import { Hono, input } from "@delebash/core/platform";
import * as llmDb from "@delebash/core/llm/db";
import { getLogger } from "@delebash/core/platform/log";
import { readSettings, SETTING_KEYS, SettingsPatch, writeSettings } from "../settings.js";

const log = getLogger("just_ai_i18n_docgen.settings");

export function router() {
  const app = new Hono();

  app.get("/v1/settings", (c) => c.json(readSettings(llmDb.session(), SETTING_KEYS)));

  app.patch("/v1/settings", input({ body: SettingsPatch }), (c) => {
    const patch = c.req.valid("json");
    writeSettings(llmDb.session(), patch);
    const keys = Object.keys(patch);
    if (keys.length) log.info(`settings changed: ${keys.join(", ")}`);
    return c.json(readSettings(llmDb.session(), SETTING_KEYS));
  });

  return app;
}
