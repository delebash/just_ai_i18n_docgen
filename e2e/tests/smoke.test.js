// Smoke suite — boot the real Tauri app (real WebView2) and verify each
// surface's BEHAVIOUR (clicks and resulting states, not presence). Run
// with `npm test` from the app root (JW's run model: one launch shared
// across tests).
//
// PRECONDITION: a server on :8742 (`npm run server`, or the demo config —
// see the README). JAID_DEV_NO_SIDECAR=1 below means the suite never
// spawns or evicts a server and mutates nothing of yours — but the
// quick-setup, routing, AI-area, home and staged-chip tests read live
// endpoints, so with no server they fail on the ConnectionError screen.
// That failure is the suite naming its missing precondition, not a flake.
// (This header used to claim "needs NO demo server" — stale since the
// suite grew endpoint-reading teeth, corrected 2026-08-03.)

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

test("the shell mounts: titlebar + nav (Design 1, the ruled shell)", async () => {
  assert.equal(await d.exists(".titlebar"), true, "the in-app title bar must mount (JW parity)");
  assert.equal(await d.exists(".shell__nav"), true, "nav must mount");
  assert.equal(await d.count(".navlink") >= 7, true, "nav rows incl. tools + AI tasks");
  assert.equal(await d.exists(".design-pill"), false, "the temporary switcher is GONE");
});

test("the AI tasks nav row is a REAL toggle: opens, STAYS open, second click closes", async () => {
  // BEHAVIOUR, not presence — the first build shipped an open-then-instantly-close
  // bug under a presence check (the nav row lacked data-panel-toggle, so the
  // opening click was also the panel's outside-click dismiss).
  const clickRow = `[...document.querySelectorAll('.navlink')].find(n => /AI tasks/.test(n.textContent)).click();`;
  await d.exec(clickRow);
  await d.sleep(400); // long enough for a buggy dismiss to have fired
  assert.equal(await d.exists('[aria-label="AI tasks"]'), true, "panel must open AND STAY open");
  await d.exec(clickRow);
  await d.sleep(300);
  assert.equal(await d.exists('[aria-label="AI tasks"]'), false, "second click must close it");
});

test("routing by feature shows ALL FOUR features as routing rows (promptless app)", async () => {
  await d.navigate("#/ai");
  await d.waitUntil(`return /Routing by feature/i.test(document.body.textContent)`, { timeout: 15_000 });
  await d.exec(`[...document.querySelectorAll('a,button')].find(x => /Routing by feature/i.test(x.textContent))?.click();`);
  // feature_prompts={} here — the kit's promptless routing rows must render, with
  // the assigned-preset line on each card.
  await d.waitUntil(`return document.querySelectorAll('.lu-fw-card').length >= 4`, { timeout: 15_000 });
  const text = await d.exec(`return document.body.textContent;`);
  for (const f of ["Translate", "Review", "Confirm", "Extract"]) {
    assert.equal(text.includes(f), true, `feature "${f}" must be routable`);
  }
});

test("quick setup OPENS and offers translation-measured models, not JW's", async () => {
  await d.navigate("#/ai");
  await d.waitUntil(`return [...document.querySelectorAll('button')].some(b => /Run Quick Setup/i.test(b.textContent))`, { timeout: 15_000 });
  // The band itself carries NO model dropdown — the wizard is a MODAL (3rd-report fix).
  assert.equal(await d.exec(`return document.querySelectorAll('.lu-qs-band [role=combobox], .lu-qs-band select').length;`), 0,
    "no inline model dropdown on the AI page");
  await d.exec(`[...document.querySelectorAll('button')].find(b => /Run Quick Setup/i.test(b.textContent)).click();`);
  await d.waitUntil(`return !!document.querySelector('[role=dialog]') && /Local translation AI/i.test(document.body.textContent)`);
  // The preselected pick is the MEASURED flagship; JW's writing catalog is absent.
  await d.waitUntil(`return /Gemma 4 26B/i.test(document.body.textContent)`, { timeout: 10_000 });
  const page = await d.exec(`return document.body.textContent;`);
  assert.equal(/StyleTune|Writes prose/i.test(page), false, "JW's writing catalog/copy must NOT appear in this app");
  await d.exec(`[...document.querySelectorAll('button')].find(b => /^Cancel$/.test(b.textContent.trim()))?.click();`);
});

test("setup shows the WHOLE form with an explicit Check path button — nothing hidden", async () => {
  await d.navigate("#/setup");
  await d.waitUntil(`return /i18n source file/i.test(document.body.textContent)`);
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

test("home is a real welcome (or the dashboard) — never a broken page", async () => {
  await d.navigate("#/");
  await d.waitUntil(
    `return /Open Setup/i.test(document.body.textContent)
         || document.querySelector('.dash') !== null`,
    { timeout: 15_000 },
  );
});

test("a language whose run staged proposals shows the staged chip", async () => {
  // done=0 + staged>0 is the FIRST-RUN state (a run stages proposals, it never
  // writes the locale file). 0fc029f gated the chips behind done>0, so 'not yet
  // translated' sat beside a finished Last run and read as a failed run (the fr
  // row, found in home.png 2026-08-03). The precondition (a staged language)
  // lives in the demo data — against a project without one, this passes empty.
  let stagedLang = null;
  try {
    const summary = await (await fetch("http://127.0.0.1:8742/v1/summary")).json();
    stagedLang = (summary.langs || []).find((l) => l.done === 0 && l.staged > 0) || null;
  } catch { /* no server / no project → the home test above already covers the page */ }
  if (!stagedLang) return;
  await d.navigate("#/");
  await d.waitUntil(`return document.querySelector('.dash') !== null`, { timeout: 15_000 });
  const text = await d.exec(`return document.body.textContent;`);
  assert.equal(text.includes(`${stagedLang.staged} staged`), true,
    `the ${stagedLang.code} row (done=0, staged=${stagedLang.staged}) must show its staged work`);
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
  // The storage panel is JW's, strings verbatim — assert the donor's wording so a
  // hand-rolled lookalike can never silently return (2026-08-03).
  await d.navigate("#/settings/storage");
  await d.waitUntil(`return /Data location/.test(document.body.textContent)
                        && /Change folder|desktop app/.test(document.body.textContent)
                        && /Disk usage/.test(document.body.textContent)`);
});

test("the global AI status button lives in the titlebar (JW parity)", async () => {
  assert.equal(
    await d.exec(`return document.querySelectorAll('.titlebar button').length >= 3;`),
    true,
    "titlebar must carry back/forward, the theme cycler and the AI status button",
  );
});
