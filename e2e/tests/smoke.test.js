// SPDX-License-Identifier: MIT
// The smoke suite — the REAL desktop app (Electron, the built UI from app://) driven through Playwright (app-structure
// §10, §18). It verifies each surface's BEHAVIOUR (clicks and the states they lead to, not presence). Hermetic
// (lib/driver.js, the template's): a temp data folder, the harness's own server, the shell's
// JUST_AI_I18N_DOCGEN_DEV_NO_SERVER=1 — and the project is the suite's own (lib/fixture.js), never yours. One launch
// shared by the tests, in order.
//
// No real model and no network unless JUST_AI_I18N_DOCGEN_REAL_MODEL=1 asks (§18): then "quick setup RUNS" also applies
// the setup — an engine install and a model download start, and are cancelled.
//
// Before: `npm run build:unpacked` (the harness drives what was last built). Run: `npm test` from the app's root.

import { strict as assert } from "node:assert";
import path from "node:path";
import { after, before, test } from "node:test";
import { Driver, waitFor } from "../lib/driver.js";
import { loadFixture, makeFixture } from "../lib/fixture.js";

const REAL_MODEL = process.env.JUST_AI_I18N_DOCGEN_REAL_MODEL === "1";

const d = new Driver();
let page;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait until a script body run in the page answers truthy. */
const until = (body, { timeout = 15_000, what = body.slice(0, 120) } = {}) =>
  waitFor(() => d.exec(`return (function(){ ${body} })();`), { timeout, what });
const bodyText = () => d.exec("return document.body.textContent;");

before(async () => {
  await d.startServer();
  await loadFixture(d);
  await d.launch();
  page = d.page;
  await d.maximize();
  await page.waitForSelector(".shell", { timeout: 30_000 });
});

after(async () => {
  await d.close();
});

test("the window is the app's", async () => {
  assert.match(await page.title(), /i18n/i);
  assert.match(page.url(), /^app:\/\/just-ai-i18n-docgen\//);
});

test("the shell mounts: titlebar + nav (Design 1, the ruled shell)", async () => {
  assert.equal(await page.locator(".titlebar").count(), 1, "the in-app title bar must mount (JW parity)");
  assert.equal(await page.locator(".shell__nav").count(), 1, "nav must mount");
  assert.equal((await page.locator(".navlink").count()) >= 7, true, "nav rows incl. tools + AI tasks");
  assert.equal(await page.locator(".design-pill").count(), 0, "the temporary switcher is GONE");
});

test("the global AI status button lives in the titlebar (JW parity)", async () => {
  assert.equal(await page.locator(".titlebar .ai-status-btn").count(), 1, "the kit's AiStatusButton is in the title bar");
});

test("the AI tasks nav row is a REAL toggle: opens, STAYS open, second click closes", async () => {
  // BEHAVIOUR, not presence — the first build shipped an open-then-instantly-close bug under a presence check (the
  // nav row lacked data-panel-toggle, so the opening click was also the panel's outside-click dismiss). The panel by
  // its id (the kit's AI_TASKS_PANEL_ID, which the row's aria-controls names).
  const row = page.locator(".navlink", { hasText: "AI tasks" });
  const panel = page.locator("#ai-tasks-panel");
  assert.equal(await panel.count(), 0, "the panel starts closed");
  await row.click();
  await sleep(400); // long enough for a buggy dismiss to have fired
  assert.equal(await panel.count(), 1, "panel must open AND STAY open");
  // the open panel's backdrop lies over the row; the row is the panel's own toggle (data-panel-toggle), so the click
  // goes to it as a person's would (the template's test: force past Playwright's covered-element check)
  await row.click({ force: true });
  // the kit's QDialog slides shut: gone once its leave transition ends
  await panel.waitFor({ state: "detached", timeout: 3_000 });
});

test("routing by feature shows the THREE routed features; the Lab runs the real prompt row", async () => {
  await d.navigate("#/ai");
  await until("return /Routing by feature/i.test(document.body.textContent)");
  await page.locator(".lu-subnav [role=tab]", { hasText: "Routing by feature" }).click();
  // one card per feature, each its one prompt row (seed_feature_prompts.js, 2026-10-29); extract never calls the
  // engine, so it is no routing row
  await until("return document.querySelectorAll('.lu-fw-card').length >= 3");
  const text = await bodyText();
  for (const f of ["Translate", "Review", "Confirm"]) assert.equal(text.includes(f), true, `feature "${f}" must be routable`);
  assert.equal(await page.locator(".lu-fw-card", { hasText: "Extract" }).count(), 0, "extract must NOT be a routing row");
  // The Lab over the translate row: the row the server runs is the one the Lab edits, its test input fills from the
  // project's languages, and the doors to the data the prompt is fed stay on the page.
  await page.locator(".lu-fw-card", { hasText: "Translate" }).first().click();
  await until("return /Test input/.test(document.body.textContent)");
  const { prompts } = await d.api("/ai/prompts");
  assert.equal(prompts.find((p) => p.key === "translate")?.jsonMode, true, "the server's translate row answers in JSON");
  assert.equal(
    await d.exec(`return [...document.querySelectorAll('textarea')].some(t => t.value.includes("professional software-UI translator"));`),
    true,
    "the Lab shows the translate row's own text",
  );
  const lab = await bodyText();
  assert.equal(/Insert from language/.test(lab), true, "the test input fills from the project's languages");
  assert.equal(/Save as preset/i.test(lab), true, "the preset surface renders");
  assert.equal(/Change what this prompt says:/.test(lab) && /Context & glossary/.test(lab), true, "the data links render on the row's Lab");
  const vars = await d.api("/ai/test-variables?action=translate&lang=es");
  assert.equal(typeof vars.variables?.items, "string", "the server builds the Lab's test input from the project's Spanish");
});

/** Open the Quick Setup wizard on its confirm step (a set-up box shows "Already set up" first). */
async function openQuickSetup() {
  await d.navigate("#/ai");
  await until("return [...document.querySelectorAll('button')].some(b => /Run Quick Setup|Re-run Quick Setup/i.test(b.textContent))");
  await d.exec("[...document.querySelectorAll('button')].find(b => /Run Quick Setup|Re-run Quick Setup/i.test(b.textContent)).click();");
  await until("return !!document.querySelector('[role=dialog]') && /Already set up|Local translation AI/i.test(document.querySelector('[role=dialog]').textContent)", { timeout: 20_000 });
  if (await d.exec("return /Already set up/i.test(document.querySelector('[role=dialog]').textContent);")) {
    await d.exec("[...document.querySelectorAll('[role=dialog] button')].find(b => /^Change model$/.test(b.textContent.trim()))?.click();");
  }
  await until("return /Local translation AI/i.test(document.body.textContent)");
}

test("quick setup OPENS and offers translation-measured models, not JW's", async () => {
  await d.navigate("#/ai");
  await until("return [...document.querySelectorAll('button')].some(b => /Run Quick Setup|Re-run Quick Setup/i.test(b.textContent))");
  // the feature's NAME is never dropped and the scope line renders in both states (naming+scope ruling 2026-08-04)
  assert.equal(await d.exec("return /Sets up the built-in llama\\.cpp provider only/i.test(document.body.textContent);"), true,
    "the band carries the built-in-only scope wording");
  // the band carries NO model dropdown — the wizard is a MODAL (3rd-report fix)
  assert.equal(await page.locator(".lu-qs-band [role=combobox], .lu-qs-band select").count(), 0, "no inline model dropdown on the AI page");
  await openQuickSetup();
  // the preselected pick is the MEASURED flagship; JW's writing catalog is absent
  await until("return /Gemma 4 26B/i.test(document.body.textContent)", { timeout: 10_000 });
  assert.equal(/StyleTune|Writes prose/i.test(await bodyText()), false, "JW's writing catalog/copy must NOT appear in this app");
  await d.exec("[...document.querySelectorAll('[role=dialog] button')].find(b => /^Cancel$/.test(b.textContent.trim()))?.click();");
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
});

test("quick setup RUNS: one Cancel at a time, the routing it writes is valid, no hang", async () => {
  // The wizard's completion path — the part a mounting check cannot see. Three defects it pins (found reading the
  // kit's QuickSetup): setAsDefault(pick) wrote the MODEL id into providerId; a footer Cancel sat beside each
  // DownloadBar's own; completion watched a derived status, so an already-resident model, a failed engine install
  // and a cancelled download left "Working…" forever. Applying installs the engine and downloads a model — real
  // network and a real model — so without JUST_AI_I18N_DOCGEN_REAL_MODEL=1 it stops at the confirm step.
  await openQuickSetup();
  await until("return [...document.querySelectorAll('[role=dialog] button')].some(b => /^Apply setup$/.test(b.textContent.trim()) && !b.disabled)", { timeout: 20_000 });
  const snapshot = `
    const dlg = document.querySelector('[role=dialog]');
    if (!dlg) return null;
    const cancels = [...dlg.querySelectorAll('button')].filter(b => /^Cancel$/.test(b.textContent.trim()));
    const bars = [...dlg.querySelectorAll('.lu-dlbar')];
    return {
      cancels: cancels.length,
      footerCancels: cancels.filter(b => !b.closest('.lu-dlbar')).length,
      bars: bars.length,
      closeX: dlg.querySelectorAll('.ui-modal__close').length,
      running: bars.some(b => [...b.querySelectorAll('button')].some(x => /^Cancel$/.test(x.textContent.trim()))),
      text: dlg.textContent,
    };`;
  const confirmStep = await d.exec(`return (() => { ${snapshot} })();`);
  assert.equal(confirmStep.cancels, 1, "confirm step: exactly one Cancel");
  assert.equal(confirmStep.bars, 0, "no progress bars before the run starts");
  if (!REAL_MODEL) {
    await d.exec("[...document.querySelectorAll('[role=dialog] button')].find(b => /^Cancel$/.test(b.textContent.trim()))?.click();");
    await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
    return;
  }

  const DONE = "Setup applied\\.";
  await d.exec("[...document.querySelectorAll('[role=dialog] button')].find(b => /^Apply setup$/.test(b.textContent.trim())).click();");
  try {
    // an already-resident model finishes on the first poll (no bar ever lingers); anything else shows a bar
    await until(`return !!document.querySelector('[role=dialog] .lu-dlbar') || /${DONE}/.test(document.querySelector('[role=dialog]')?.textContent || '')`, { timeout: 25_000 });
    const applyStep = await d.exec(`return (() => { ${snapshot} })();`);
    assert.equal(applyStep.footerCancels, 0, "the footer carries NO Cancel during a run — the bar owns it");
    assert.equal(applyStep.cancels <= applyStep.bars, true, `every Cancel belongs to a bar, saw ${applyStep.cancels} across ${applyStep.bars} bar(s)`);
    if (applyStep.running) assert.equal(applyStep.closeX, 0, "the modal is un-closable while a task runs (donor rule)");
    // the routing write: the provider stays the runner, the model is a real model id
    const t = (await d.api("/ai/engine-presets")).presets.find((p) => p.id === "p_translate");
    assert.equal(t.providerId, "local-llamacpp", "provider must stay the built-in runner");
    assert.equal(typeof t.model === "string" && t.model.length > 0 && !t.model.includes("/"), true, `the MODEL slot holds a model id, got ${JSON.stringify(t.model)}`);
    // …and the run reaches a state the user can act on — never a permanent "Working…"
    await d.exec("[...document.querySelectorAll('[role=dialog] .lu-dlbar button')].find(b => /^Cancel$/.test(b.textContent.trim()))?.click();");
    await until(`return /Cancelled|Failed|${DONE}/.test(document.querySelector('[role=dialog]')?.textContent || '')`, { timeout: 30_000 });
    const terminal = await d.exec(`return (() => { ${snapshot} })();`);
    assert.equal(terminal.running, false, "a terminal task shows no Cancel");
    assert.equal(terminal.closeX, 1, "the modal is closable again once nothing is running");
    assert.equal(/Retry/.test(terminal.text) || new RegExp(DONE).test(terminal.text), true, `a finished run succeeded or offers Retry. Saw: ${terminal.text.slice(0, 160)}`);
  } finally {
    await d.exec("document.querySelector('[role=dialog] .ui-modal__close')?.click();");
  }
});

test("home is the project's dashboard: its languages, and a language whose run staged proposals shows them", async () => {
  await d.navigate("#/");
  await page.locator(".dash").waitFor({ timeout: 15_000 });
  // done=0 + staged>0 is the FIRST-RUN state (a run stages proposals, it never writes the locale file): French's
  // two staged values must show beside its "not yet translated", never read as a failed run (found in home.png
  // 2026-08-03)
  await until("return /2 staged/.test(document.querySelector('.dash').textContent)");
  const dash = await d.exec("return document.querySelector('.dash').textContent;");
  assert.match(dash, /Spanish/);
  assert.match(dash, /French/);
});

test("setup shows the WHOLE form with an explicit Check path button — and a path that isn't there is said under it", async () => {
  await d.navigate("#/setup");
  await until("return /i18n source file/i.test(document.body.textContent)");
  // The 2026-08-02 rulings: every section is visible with no path checked, and checking is a button, never an
  // auto-run.
  const text = await bodyText();
  for (const section of ["Target languages", "Context", "Glossary", "Reviewer", "gitignore"]) {
    assert.equal(new RegExp(section, "i").test(text), true, `section "${section}" must be visible before any path check`);
  }
  assert.equal(await page.getByRole("button", { name: /check path/i }).count(), 1, "an explicit Check path button exists");
  // the path box prefills from the loaded project; a path that doesn't exist is the server's 422 under the box
  // (app-structure §15, 2026-10-29) — the box's own message, not a toast
  const box = page.locator('input[placeholder*="en.json"]');
  await until(`return !!document.querySelector('input[placeholder*="en.json"]').value`);
  const loaded = await box.inputValue();
  await box.fill(path.join(d.tmp, "nowhere", "en.json"));
  await page.getByRole("button", { name: /check path/i }).click();
  await until("return !!document.querySelector('.q-field--error .q-field__messages')?.textContent.trim()");
  assert.equal(await page.locator(".q-field--error").count(), 1, "one field in error: the path box");
  await box.fill(loaded); // as it was, for the tests after
});

test("review is the ported workspace: buckets, keyboard, the second-opinion panel", async () => {
  await d.navigate("#/review?lang=es");
  await until("return document.querySelectorAll('.review-rail .bucket').length >= 8");
  const labels = await page.locator(".review-rail .bucket").allTextContents();
  for (const want of ["Needs review", "Came back identical", "All flagged", "Accepted"]) {
    assert.equal(labels.some((l) => l.includes(want)), true, `bucket "${want}" on the rail`);
  }
  // the widest bucket: the fixture's Spanish has two identical strings and two never translated
  await page.locator(".review-rail .bucket", { hasText: "All flagged" }).click();
  await until("return document.querySelectorAll('.rrow').length > 1");
  const before = await d.exec("return document.querySelector('.rrow.on .k')?.textContent || '';");
  await d.exec("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));");
  await until(`return (document.querySelector('.rrow.on .k')?.textContent || '') !== ${JSON.stringify(before)}`, { timeout: 3_000 });
  const detail = await d.exec("return document.querySelector('.review-detail')?.textContent || '';");
  assert.equal(/Google Translate/.test(detail), true, "the second-opinion panel exists");
  assert.equal(/Skip/.test(detail), true, "Skip exists");
});

test("docs page renders the extract story", async () => {
  await d.navigate("#/docs");
  await until("return /front-matter/i.test(document.body.textContent)");
});

test("the AI area mounts — the kit's providers/models/usage surface", async () => {
  await d.navigate("#/ai");
  await until("return /providers/i.test(document.body.textContent) && /models/i.test(document.body.textContent)");
});

test("settings renders its sections, the theme cycles, the logs and the storage panel", async () => {
  await d.navigate("#/settings");
  await until("return document.querySelectorAll('.ui-tabstrip__tab').length >= 5");
  // The appearance MODE must stamp [data-theme] (2026-08-04: the mode setting did NOTHING). The titlebar cycler is
  // 3-state (system→light→dark): some click stamps dark, the third lands back where it started.
  const stamp = () => d.exec("return document.documentElement.getAttribute('data-theme');");
  const modeWas = await stamp();
  let sawDark = false;
  for (let i = 0; i < 3; i++) {
    await d.exec("[...document.querySelectorAll('.titlebar button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Theme'))?.click();");
    await sleep(150);
    if ((await stamp()) === "dark") sawDark = true;
  }
  assert.equal(sawDark, true, "cycling the mode must stamp [data-theme=dark]");
  assert.equal(await stamp(), modeWas, "three clicks = a full cycle back");
  // persisted on the server through the family /v1/prefs door, in the {appearance:{...}} shape the migrator reads
  await waitFor(async () => typeof (await d.api("/prefs")).appearance?.appearance === "object", { timeout: 5_000, what: "the appearance prefs on the server" });
  await d.navigate("#/settings/logs");
  await until("return /server logs/i.test(document.body.textContent)");
  // the kit's StoragePanel, by its words; the data folder is set by the driver's JUST_AI_I18N_DOCGEN_DATA_DIR, so the
  // panel says so instead of offering Change folder
  await d.navigate("#/settings/storage");
  await until("return /Data location/.test(document.body.textContent) && /set by JUST_AI_I18N_DOCGEN_DATA_DIR|Change folder|desktop app/.test(document.body.textContent) && /Disk usage/.test(document.body.textContent)");
});

test("a confirmed action really opens its confirm dialog (the host is mounted)", async () => {
  // confirmDialog() resolves through the <AppDialog /> host: with none mounted every confirmed action is a button that
  // does nothing (shipped so until 2026-08-03). Cancel at the end — nothing is destroyed.
  await d.navigate("#/settings/storage");
  await until("return /Disk usage/.test(document.body.textContent)");
  await d.exec("[...document.querySelectorAll('button')].find(b => /^Clear…$/.test(b.textContent.trim())).click();");
  const dialog = page.locator("[role=dialog]");
  await dialog.waitFor({ timeout: 8_000 });
  assert.match(await dialog.textContent(), /Clear downloaded models\?/, "the confirm states what it will do");
  await dialog.getByRole("button", { name: /^Cancel$/i }).click();
  await dialog.waitFor({ state: "detached", timeout: 5_000 });
});

test("setup CREATE-FLOW: a second project round-trips the real form (runs last: it changes the loaded project)", async () => {
  const enPath = makeFixture(path.join(d.tmp, "second"), { name: "second-app", staged: false });
  await d.navigate("#/setup");
  const box = page.locator('input[placeholder*="en.json"]');
  // the view prefills the path from the loaded project once its refresh answers — wait for that, or the prefill lands
  // after the new path and Save posts the old one (the race the Quasar move's router timing exposed, 2026-10-09)
  await until(`return !!document.querySelector('input[placeholder*="en.json"]').value`);
  await box.fill(enPath);
  await page.getByRole("button", { name: /check path/i }).click();
  await until("return /Placeholders/i.test(document.body.textContent) && /\\b7\\b/.test(document.querySelector('.ui-formgrid').textContent)");
  // the targets prefill from the loaded project (es, fr) — Save is on
  await page.getByRole("button", { name: /Save project/i }).click();
  await waitFor(async () => {
    const s = await d.api("/setup/state");
    return s.loaded && String(s.source || "").includes("second-app");
  }, { timeout: 15_000, what: "the second project loaded" });
});
