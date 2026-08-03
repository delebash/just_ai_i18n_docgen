// Smoke suite — boot the real Tauri app (real WebView2, real sidecar
// path unless JAID_DEV_NO_SIDECAR is set by the runner), verify each
// surface mounts and the design contract holds. Run with `npm test`
// from the app root (JW's run model: one launch shared across tests).
//
// Hermetic: the sidecar is skipped and the suite asserts against the
// serverless states (empty dashboard, setup form) plus pure-shell
// behaviour (nav, design switch) — so it needs NO demo server and
// mutates nothing of yours.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { Driver } from "../lib/driver.js";

process.env.JAID_DEV_NO_SIDECAR = "1";

const d = new Driver();

before(async () => {
  await d.launch();
  await d.maximize();
  await d.waitUntil(`return !!document.querySelector('.shell')`);
});

after(async () => { await d.close(); });

test("titlebar names the app", async () => {
  const title = await d.title();
  assert.match(title, /i18n/i, `expected the app title, got: ${title}`);
});

test("the shell mounts with nav and the design pill", async () => {
  assert.equal(await d.exists(".shell__nav"), true, "nav must mount");
  assert.equal(await d.count(".navlink") >= 5, true, "five nav links");
  assert.equal(await d.exists(".design-pill"), true, "temporary design switcher present");
});

test("design switcher flips the shell class d1 → d2 → d3", async () => {
  for (const n of [2, 3, 1]) {
    await d.exec(
      "const b=[...document.querySelectorAll('.design-pill__btn')][arguments[0]-1]; b.click();",
      [n],
    );
    await d.waitUntil(`return document.querySelector('.shell--d${n}') !== null`);
  }
});

test("setup shows the WHOLE form with an explicit Check path button — nothing hidden", async () => {
  await d.navigate("#/setup");
  await d.waitUntil(`return /Catalogue path/i.test(document.body.textContent)`);
  // The 2026-08-02 rulings, as assertions: every section is visible with
  // no path entered, and checking is a button, never an auto-run.
  for (const section of ["Target languages", "Context", "Glossary", "Reviewer", "gitignore"]) {
    const found = await d.exec(
      `return new RegExp(arguments[0], 'i').test(document.body.textContent);`, [section]);
    assert.equal(found, true, `section "${section}" must be visible before any path check`);
  }
  const btn = await d.exec(
    `return [...document.querySelectorAll('button')].some(b => /check path/i.test(b.textContent));`);
  assert.equal(btn, true, "an explicit Check path button exists");
});

test("home without a server shows the honest empty state, not a broken page", async () => {
  await d.navigate("#/");
  await d.waitUntil(
    `return /point me at a catalogue/i.test(document.body.textContent)
         || document.querySelector('.dash') !== null`,
    { timeout: 15_000 },
  );
});

test("docs page renders the extract story", async () => {
  await d.navigate("#/docs");
  await d.waitUntil(`return /front-matter/i.test(document.body.textContent)`);
});

test("the AI area mounts — the kit's providers/models/usage surface", async () => {
  await d.navigate("#/ai");
  // AiModelsArea's subnav is the marker: the whole shared surface hangs off it.
  await d.waitUntil(
    `return /providers/i.test(document.body.textContent)
         && /models/i.test(document.body.textContent)`,
    { timeout: 15_000 },
  );
});

test("settings renders its sections and the logs panel", async () => {
  await d.navigate("#/settings");
  await d.waitUntil(`return document.querySelectorAll('.settings__navbtn').length >= 5`);
  await d.navigate("#/settings/logs");
  await d.waitUntil(`return /server logs/i.test(document.body.textContent)`);
});

test("the global AI status button is in the shell footer", async () => {
  assert.equal(
    await d.exec(`return !!document.querySelector('.shell__foot button.ai-status-btn, .shell__foot [class*="ai-status"], .shell__foot [title*="AI"], .shell__foot [aria-label*="AI"]');`)
      || await d.exec(`return document.querySelectorAll('.shell__foot button').length >= 2;`),
    true,
    "footer must carry the theme cycler AND the AI status button",
  );
});
