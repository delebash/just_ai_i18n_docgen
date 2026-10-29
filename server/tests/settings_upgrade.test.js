// SPDX-License-Identifier: MIT
// A setting still at an earlier default takes today's; one its owner edited is never touched — and a default can't
// change without its old fingerprint being kept (settings.js PREVIOUS_DEFAULTS, the kit's upgradeSettings). The
// template's test, on docgen's settings.
import * as llmDb from "@delebash/core/llm/db";
import { defaultsFingerprints, fingerprint, upgradeSettings as upgradeToToday } from "@delebash/core/platform";
import { beforeEach, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { getAppSetting, PREVIOUS_DEFAULTS, SETTING_DEFAULTS, seedSettings, setAppSetting, upgradeSettings } from "../src/settings.js";
import { tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

beforeEach(async () => {
  await createApp(tmpDir());
});

// Today's default of EVERY setting. A change here means a default changed: add the OLD fingerprint to
// PREVIOUS_DEFAULTS (so installs still holding it get the new one), then update this line.
const TODAY = {
  "windows.checkSeconds": "4e07408562bedb8b",
};

test("today's defaults are the ones this test knows, and none of them is listed as earlier", () => {
  expect(defaultsFingerprints(SETTING_DEFAULTS)).toEqual(TODAY);
  for (const [key, print] of Object.entries(TODAY)) expect(PREVIOUS_DEFAULTS[key] ?? []).not.toContain(print);
});

test("a setting still at an earlier default takes today's; an edited one is left alone", () => {
  const h = llmDb.session();
  seedSettings(h);
  expect(upgradeSettings(h)).toEqual([]); // a fresh install holds today's
  // as an install made before a change would: an earlier check interval
  setAppSetting(h, "windows.checkSeconds", 5);
  const previous = { "windows.checkSeconds": [fingerprint(5)] };
  expect(upgradeToToday(h, { defaults: SETTING_DEFAULTS, previous, getSetting: getAppSetting, setSetting: setAppSetting })).toEqual(["windows.checkSeconds"]);
  expect(getAppSetting(h, "windows.checkSeconds")).toBe(3);
  // the owner's own value
  setAppSetting(h, "windows.checkSeconds", 9);
  expect(upgradeToToday(h, { defaults: SETTING_DEFAULTS, previous, getSetting: getAppSetting, setSetting: setAppSetting })).toEqual([]);
  expect(getAppSetting(h, "windows.checkSeconds")).toBe(9);
});
