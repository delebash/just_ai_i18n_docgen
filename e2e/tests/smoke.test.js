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

test("routing by feature shows the THREE routed features, with the full Lab (promptless app)", async () => {
  await d.navigate("#/ai");
  await d.waitUntil(`return /Routing by feature/i.test(document.body.textContent)`, { timeout: 15_000 });
  await d.exec(`[...document.querySelectorAll('a,button')].find(x => /Routing by feature/i.test(x.textContent))?.click();`);
  // feature_prompts={} here — the kit renders promptless rows with the assigned-preset
  // line on each card. Extract left the catalog 2026-08-04: it never calls the engine
  // (pure front-matter parsing), so a routing row for it was a lie; it returns the day
  // it gains a real AI step (the CLI `extract` door is untouched).
  await d.waitUntil(`return document.querySelectorAll('.lu-fw-card').length >= 3`, { timeout: 15_000 });
  const text = await d.exec(`return document.body.textContent;`);
  for (const f of ["Translate", "Review", "Confirm"]) {
    assert.equal(text.includes(f), true, `feature "${f}" must be routable`);
  }
  assert.equal(
    await d.exec(`return [...document.querySelectorAll('.lu-fw-card')].some(c => /Extract/.test(c.textContent));`),
    false, "extract must NOT be a routing row");
  // The promptless Lab (2026-08-04): selecting a feature shows the REAL generated
  // prompt — model selection, params and Save-as-preset render for a promptless app.
  await d.exec(`[...document.querySelectorAll('.lu-fw-card')].find(c => /Translate/.test(c.textContent))?.click();`);
  await d.waitUntil(`return /Generated prompt/.test(document.body.textContent)`, { timeout: 15_000 });
  const page = await d.exec(`return document.body.textContent;`);
  assert.equal(/never|nothing here is saved/i.test(page), true, "the test-only banner must state the contract");
  assert.equal(/Save as preset/i.test(page), true, "the preset surface must render for a promptless feature");
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
  await d.exec(`[...document.querySelectorAll('[role=dialog] button')].find(b => /^Cancel$/.test(b.textContent.trim()))?.click();`);
});

test("quick setup RUNS: one Cancel at a time, the routing it writes is valid, no hang", async () => {
  // The wizard's completion path — the part a mounting check cannot see. It drives the
  // REAL run, so it writes routing; the presets are saved and restored below.
  //
  // Three defects this pins, all found by reading the donor (kit QuickSetup) after the
  // user asked "does JW have two cancel buttons?" — no, it has one, and the modal is
  // un-closable while a task runs:
  //   1. setAsDefault(pick) wrote the MODEL id into providerId and undefined into model.
  //   2. a footer Cancel sat beside each DownloadBar's own Cancel — two controls, one
  //      word, different meanings (the footer's left the download running).
  //   3. completion watched a derived model status, so an already-resident model, a
  //      failed engine install and a cancelled download all left "Working…" forever.
  const API = "http://127.0.0.1:8742";
  let saved = null;
  try {
    saved = (await (await fetch(`${API}/v1/ai/engine-presets`)).json()).presets;
  } catch { return; } // no server → the precondition tests above already said so
  const before = saved.find((p) => p.id === "p_translate");

  await d.navigate("#/ai");
  await d.waitUntil(`return [...document.querySelectorAll('button')].some(b => /Run Quick Setup/i.test(b.textContent))`, { timeout: 15_000 });
  await d.exec(`[...document.querySelectorAll('button')].find(b => /Run Quick Setup/i.test(b.textContent)).click();`);
  // Wait for the wizard to be READY, not merely present: it primes the catalog, the
  // ranking and the engine status first (its detect step). Clicking the instant the
  // dialog existed hit a disabled button and no run ever started — found by this test
  // on 2026-08-03, which is why the wizard now has a priming step to wait for.
  await d.waitUntil(
    `return !!document.querySelector('[role=dialog]')
         && [...document.querySelectorAll('[role=dialog] button')]
              .some(b => /^Set it up$/.test(b.textContent.trim()) && !b.disabled)`,
    { timeout: 20_000 },
  );

  // ONE atomic DOM read, so the assertions can't race the task's own state changes.
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

  await d.exec(`[...document.querySelectorAll('[role=dialog] button')].find(b => /^Set it up$/.test(b.textContent.trim())).click();`);
  // TWO honest outcomes, and the test must not assume the slow one. A model that is
  // ALREADY RESIDENT finishes on the load channel's first poll (readLoadStatus returns
  // terminal `done` the moment /status says the router is running), so the wizard lands
  // on its done step and no bar ever lingers — the very case the rewrite exists to fix.
  // Anything else shows a bar: downloading, installing, or failing.
  await d.waitUntil(
    `return !!document.querySelector('[role=dialog] .lu-dlbar')
         || /Ready to translate/.test(document.querySelector('[role=dialog]')?.textContent || '')`,
    { timeout: 25_000 },
  );

  const applyStep = await d.exec(`return (() => { ${snapshot} })();`);
  assert.equal(applyStep.footerCancels, 0, "the footer carries NO Cancel during a run — the bar owns it");
  assert.equal(applyStep.cancels <= 1, true, `at most one Cancel on screen, saw ${applyStep.cancels}`);
  if (applyStep.running) {
    assert.equal(applyStep.closeX, 0, "the modal is un-closable while a task runs (donor rule)");
  }

  // The routing write: provider stays the runner, model is a real model id.
  const after = (await (await fetch(`${API}/v1/ai/engine-presets`)).json()).presets;
  const t = after.find((p) => p.id === "p_translate");
  assert.equal(t.providerId, "local-llamacpp", "provider must stay the built-in runner");
  assert.equal(typeof t.model === "string" && t.model.length > 0, true,
    `the MODEL slot must hold the model id, got ${JSON.stringify(t.model)}`);
  assert.equal(t.model.includes("/"), false, "a model id, not a provider id or a path");

  // …and the run must reach a state the user can act on — NEVER a permanent "Working…".
  // Cancel it if it is still going (a box without the weights downloads gigabytes), then
  // require a terminal: either the wizard's done step, or a bar carrying its own Retry.
  await d.exec(`[...document.querySelectorAll('[role=dialog] .lu-dlbar button')].find(b => /^Cancel$/.test(b.textContent.trim()))?.click();`);
  await d.waitUntil(
    `return /Cancelled|Failed|Ready/.test(document.querySelector('[role=dialog]')?.textContent || '')`,
    { timeout: 30_000 },
  );
  const terminal = await d.exec(`return (() => { ${snapshot} })();`);
  assert.equal(terminal.running, false, "a terminal task shows no Cancel");
  assert.equal(terminal.closeX, 1, "the modal is closable again once nothing is running");
  assert.equal(/Retry/.test(terminal.text) || /Ready to translate/.test(terminal.text), true,
    `a finished run either succeeded or offers Retry — never a dead end. Saw: ${terminal.text.slice(0, 160)}`);

  await d.exec(`document.querySelector('[role=dialog] .ui-modal__close')?.click();`);
  // Put the user's routing back exactly as it was (this test wrote it on purpose).
  for (const p of saved) {
    await fetch(`${API}/v1/ai/engine-presets/${p.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
    });
  }
  const restored = (await (await fetch(`${API}/v1/ai/engine-presets`)).json()).presets
    .find((p) => p.id === "p_translate");
  assert.equal(restored.model, before.model, "the test restored the routing it changed");
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

test("a confirmed action really opens its confirm dialog (the host is mounted)", async () => {
  // confirmDialog() resolves through the <AppDialog /> host. With no host mounted the
  // promise never settles, so EVERY confirmed action — Change folder, Clear models
  // cache, Clear spawn logs, Apply all staged — is a button that does nothing. The app
  // shipped that way until 2026-08-03 under a test that asserted the panel's STRINGS.
  // Cancel is clicked at the end, so this test destroys nothing.
  await d.navigate("#/settings/storage");
  await d.waitUntil(`return /Disk usage/.test(document.body.textContent)`, { timeout: 15_000 });
  await d.exec(`[...document.querySelectorAll('button')].find(b => /^Clear$/.test(b.textContent.trim())).click();`);
  await d.waitUntil(`return !!document.querySelector('[role=dialog]')`, { timeout: 8_000 });
  const text = await d.exec(`return document.querySelector('[role=dialog]').textContent;`);
  assert.match(text, /Clear downloaded models\?/, "the confirm must state what it will do");
  await d.exec(`[...document.querySelectorAll('[role=dialog] button')].find(b => /^Cancel$/i.test(b.textContent.trim()))?.click();`);
  await d.sleep(400);
  assert.equal(await d.exists("[role=dialog]"), false, "Cancel must close it");
});

test("the global AI status button lives in the titlebar (JW parity)", async () => {
  assert.equal(
    await d.exec(`return document.querySelectorAll('.titlebar button').length >= 3;`),
    true,
    "titlebar must carry back/forward, the theme cycler and the AI status button",
  );
});
