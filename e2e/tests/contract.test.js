// SPDX-License-Identifier: MIT
// THE FAMILY SURFACE CONTRACT — this app's gate (2026-08-04). Static scans only: no
// app, no server, no driver — `npm run contract` runs it alone; `npm test` runs it
// with the smoke. The canon lives in the kit's familyContract.js; drift here is a red
// run, not a screenshot the user has to catch. Verified to BITE before it counted:
// injecting a raw <table class="plain"> and renaming a nav label each failed exactly
// one assertion, then were restored.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FAMILY_LABELS } from "../../../just-llm-runner/ui/src/common/familyContract.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const viewFiles = readdirSync(path.join(root, "src", "views")).filter((f) => f.endsWith(".vue"));

test("the nav trio takes its words FROM the contract (by construction)", () => {
  const app = read("src/App.vue");
  assert.ok(app.includes("FAMILY_LABELS.nav.aiSettings"), "AI Settings label must come from the contract");
  assert.ok(app.includes("FAMILY_LABELS.nav.appSettings"), "App Settings label must come from the contract");
  assert.ok(app.includes("AI tasks"), `the AI-tasks row carries the canon words ("${FAMILY_LABELS.nav.aiTasks}")`);
  // The retired inventions must not come back.
  assert.ok(!/label:\s*"AI"/.test(app), 'the nav must not say bare "AI" again');
  assert.ok(!/label:\s*"Settings"/.test(app), 'the nav must not say bare "Settings" again');
});

test("no hand-rolled primitives where the kit has the control", () => {
  assert.ok(viewFiles.length >= 5, "the view scan must actually scan views (vacuous pass guard)");
  for (const f of viewFiles) {
    const src = read(path.join("src", "views", f));
    // Tables are the kit's: UiTable for grids, .ui-formgrid for fact sheets.
    const rawTables = [...src.matchAll(/<table\s+class="(?!ui-)[^"]*"/g)];
    assert.equal(rawTables.length, 0, `${f}: raw <table> — use UiTable or class="ui-formgrid"`);
    assert.ok(!src.includes('class="progressbar"'), `${f}: hand-rolled progress bar — use UiProgress`);
    assert.ok(!/class="bar\b/.test(src), `${f}: hand-rolled inline bar — use UiProgress bare`);
    assert.ok(!src.includes("settings__rail"), `${f}: the settings rail is dead — use the kit SettingsShell`);
  }
});

test("boot is ONE splash: the static layer is the plate, never a spinner", () => {
  const html = read("index.html");
  assert.ok(html.includes("splash-plate.jpg"), "index.html's pre-JS layer must show the plate");
  assert.ok(!html.includes("app-boot__spin"), "the spinner splash must not return");
});

test("the settings sections use the contract's words for shared concepts", () => {
  // Slice 11 moved the section ORDER into settingsSections.js (the vitest canon
  // test asserts the relative order against the kit manifest); the view maps
  // every id through the contract's words. Assert both halves of that shape.
  const settings = read("src/views/SettingsView.vue");
  assert.ok(
    settings.includes("FAMILY_LABELS.settingsSections[") &&
      settings.includes("SETTINGS_SECTION_IDS.map"),
    "SettingsView must build its sections from settingsSections.js, labeled from the contract",
  );
  const ids = read("src/views/settingsSections.js");
  // backups + updates joined the canon in the family parity batch (2026-08-06).
  for (const key of ["appearance", "backups", "storage", "server", "logs", "updates", "about"]) {
    assert.ok(ids.includes(`"${key}"`), `Settings section "${key}" must be rendered`);
  }
});
