// SPDX-License-Identifier: MIT
// Port of tests/test_workspace.py — the review workspace API: the flows ported from
// server.test.js that carry the design's promises: a job writes ONLY proposals, one call is
// one undo, an acceptance can be revisited, setup works with NO project, and every write path
// retires the machine opinions that were about the old text.
//
// Python's `monkeypatch.setattr(workspace_api, "make_send", …)` is
// `vi.spyOn(workspaceApi, "makeSend")` (the module calls it through `self.`).
import { mkdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import * as workspaceApi from "../src/api/workspace_api.js";
import { createApp } from "../src/app.js";
import { getState } from "../src/app_state.js";
import { getReference, proposals, putProposal, putReference } from "../src/state.js";
import { existsSync } from "node:fs";
import { testClient, tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

const EN = { greet: "Hello {name}", sidebar: { books: "Books" }, common: { no: "No" } };
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const itemsOf = (user) => JSON.parse(/Translate items: (\[.*\])$/s.exec(user)[1]);

function makeProject(root) {
  const appDir = join(root, "myapp");
  mkdirSync(join(appDir, "src", "locales"), { recursive: true });
  writeFileSync(join(appDir, "package.json"), "{}", "utf8");
  writeFileSync(join(appDir, "src", "locales", "en.json"), JSON.stringify(EN), "utf8");
  writeFileSync(
    join(appDir, "src", "locales", "es.json"),
    JSON.stringify({ greet: "Hola {name}", sidebar: { books: "Libros" }, common: { no: "No" } }),
    "utf8",
  );
  mkdirSync(join(appDir, "just-ai-i18n-docgen"));
  const config = join(appDir, "just-ai-i18n-docgen", "config.json");
  writeFileSync(config, JSON.stringify({ source: "../src/locales/en.json", targets: ["es"], context: "a test app" }), "utf8");
  return config;
}

let root;
let client;
let configPath;
let esPath;
beforeEach(async () => {
  root = tmpDir();
  configPath = makeProject(root);
  esPath = join(dirname(dirname(configPath)), "src", "locales", "es.json");
  client = testClient(await createApp(join(root, "data"), configPath));
});

/** A fake engine that answers every item with "NUEVO <text>". */
const fakeSend = (_system, user) =>
  JSON.stringify({ items: itemsOf(user).map((it) => ({ id: it.id, translation: `NUEVO ${it.text}` })) });
const patchSend = () => vi.spyOn(workspaceApi, "makeSend").mockImplementation(() => fakeSend);

test("state_reports_langs_progress_and_no_job", async () => {
  const s = (await client.get("/v1/state")).json();
  expect(s.langs).toEqual(["es"]);
  expect(s.job).toBeNull();
  expect(s.progress.es).toEqual({ reviewed: 0, skipped: 0 });
});

test("rows_carry_the_cognate_finding_and_missing_keys", async () => {
  // Delete one key from es.json so `missing` shows too.
  const es = readJson(esPath);
  delete es.greet;
  writeFileSync(esPath, JSON.stringify(es), "utf8");

  const body = (await client.get("/v1/rows")).json();
  const byKey = Object.fromEntries(body.rows.map((r) => [r.key, r]));
  expect(byKey["common.no"].flags.map((f) => f.code)).toContain("untranslated");
  expect(byKey.greet.flags[0].code).toBe("missing");
  expect(body.counts.missing).toBe(1);
});

test("save_writes_the_locale_rechecks_and_records_an_undoable_edit", async () => {
  const r = await client.post("/v1/save", { json: { lang: "es", key: "sidebar.books", value: "Los libros" } });
  expect(r.statusCode).toBe(200);
  expect(readJson(esPath).sidebar.books).toBe("Los libros");

  // Undo puts the previous value back.
  await client.post("/v1/undo", { json: {} });
  expect(readJson(esPath).sidebar.books).toBe("Libros");
});

test("save_to_an_unknown_key_is_404", async () => {
  expect((await client.post("/v1/save", { json: { lang: "es", key: "nope", value: "x" } })).statusCode).toBe(404);
});

test("bulk_accept_is_one_undo_and_unaccept_can_revisit", async () => {
  const r = await client.post("/v1/accept", { json: { lang: "es", keys: ["common.no"] } });
  expect(r.statusCode).toBe(200);
  expect(r.json().recorded).toBe(1);
  expect((await client.get("/v1/rows")).json().counts.untranslated).toBeUndefined();
  const accepted = (await client.get("/v1/accepted", { params: { lang: "es" } })).json().entries;
  expect(accepted.length).toBe(1);
  // Unclaimed reviewer: the entry says "unknown" rather than borrowing a name.
  expect(accepted[0].by).toBe("unknown");

  // Unaccept — the fix for the one-way complaint.
  const r2 = await client.request("DELETE", "/v1/accept", { json: { lang: "es", key: "common.no" } });
  expect(r2.json().removed).toBe(1);
  expect((await client.get("/v1/rows")).json().counts.untranslated).toBe(1);

  // Undo the unaccept: the entries come back.
  await client.post("/v1/undo", { json: {} });
  expect((await client.get("/v1/accepted", { params: { lang: "es" } })).json().entries.length).toBe(1);
});

test("reviewer_is_stored_in_the_app_db_and_stamps_acceptances", async () => {
  await client.put("/v1/reviewer", { json: { reviewer: "dana" } });
  expect((await client.get("/v1/reviewer")).json().reviewer).toBe("dana");
  await client.post("/v1/accept", { json: { lang: "es", keys: ["common.no"] } });
  const entries = (await client.get("/v1/accepted", { params: { lang: "es" } })).json().entries;
  expect(entries[0].by).toBe("dana");
});

test("notes_roundtrip_and_undo", async () => {
  await client.put("/v1/notes", { json: { lang: "es", key: "common.no", note: "a label, not a question" } });
  let row = (await client.get("/v1/rows")).json().rows.find((r) => r.key === "common.no");
  expect(row.note).toBe("a label, not a question");
  await client.post("/v1/undo", { json: {} });
  row = (await client.get("/v1/rows")).json().rows.find((r) => r.key === "common.no");
  expect(row.note).toBeNull();
});

test("siblings_show_the_namespace_neighbours", async () => {
  const body = (await client.get("/v1/siblings", { params: { lang: "es", key: "sidebar.books" } })).json();
  expect(body.namespace).toBe("sidebar");
});

test("a_job_stages_proposals_and_never_touches_the_locale_file", async () => {
  // RULE 1 of jobs.js, the governing principle: the locale file is byte-identical when a run
  // finishes; engine output is staged and applied by a person.
  patchSend();
  const before = readFileSync(esPath, "utf8");

  const r = await client.post("/v1/jobs", { json: { lang: "es", scope: "all" } });
  expect(r.statusCode).toBe(202);
  const ws = getState().workspace;
  await ws.jobs.settled();
  expect(ws.jobs.status().state).toBe("done");

  expect(readFileSync(esPath, "utf8"), "a job must write ONLY proposals — the locale file is untouched").toBe(before);
  const props = (await client.get("/v1/proposals", { params: { lang: "es" } })).json().proposals;
  expect(props.length).toBe(Object.keys(EN.sidebar).length + 2); // every key staged

  // Applying is the explicit human action that writes the file.
  const r2 = await client.post("/v1/proposals/apply", { json: { lang: "es", keys: ["common.no"] } });
  expect(r2.json().applied).toEqual(["common.no"]);
  expect(readJson(esPath).common.no.startsWith("NUEVO")).toBe(true);

  // …and it is UNDOABLE. Until 2026-08-03 `undo` had no branch for an applied proposal: it
  // popped the action, answered {"undone": …} and left the overwritten text on disk.
  await client.post("/v1/undo", { json: {} });
  expect(readJson(esPath).common.no, "undo must put the pre-apply text back").toBe("No");
});

test("applying_many_proposals_is_ONE_undo", async () => {
  // A run stages a proposal per key, so "apply what this run produced" is a whole-catalogue
  // action — and 2,000 undo entries would put the one thing you want after a bad run (put it
  // back) out of reach. One click, one undo.
  patchSend();
  const before = readJson(esPath);

  await client.post("/v1/jobs", { json: { lang: "es", scope: "all" } });
  await getState().workspace.jobs.settled();

  const keys = (await client.get("/v1/proposals", { params: { lang: "es" } })).json().proposals.map((p) => p.key);
  expect(keys.length).toBeGreaterThan(1);
  const r = await client.post("/v1/proposals/apply", { json: { lang: "es", keys } });
  expect([...r.json().applied].sort()).toEqual([...keys].sort());
  const after = readJson(esPath);
  expect(after.sidebar.books.startsWith("NUEVO")).toBe(true);
  expect(after.greet.startsWith("NUEVO")).toBe(true);

  // ONE undo restores EVERY key the click wrote — not just the last one.
  await client.post("/v1/undo", { json: {} });
  expect(readJson(esPath)).toEqual(before);
  // …and there is nothing left to undo: the batch was a single action.
  expect((await client.post("/v1/undo", { json: {} })).statusCode).toBe(404);
});

test("an_unknown_scope_must_not_start_a_job", async () => {
  const r = await client.post("/v1/jobs", { json: { lang: "es", scope: "everythingish" } });
  expect(r.statusCode).toBe(400);
  expect(r.json().detail).toContain("unknown scope");
});

test("summary_reports_per_language_counts", async () => {
  // The dashboard's one call: counts per language, never the strings.
  const es = readJson(esPath);
  delete es.greet; // one missing key → done < total
  writeFileSync(esPath, JSON.stringify(es), "utf8");

  const body = (await client.get("/v1/summary")).json();
  expect(body.keyCount === 3 && body.source === "en").toBe(true);
  expect(body.langs.length).toBe(1);
  const [lang] = body.langs;
  expect(lang.code).toBe("es");
  expect([lang.done, lang.total]).toEqual([2, 3]);
  // "No" is byte-identical to its source → at least the untranslated finding, none of it
  // reviewed yet, nothing accepted, no run recorded.
  expect(lang.findings >= 1 && lang.unreviewed >= 1).toBe(true);
  expect(lang.accepted === 0 && lang.staged === 0 && lang.lastRun === null).toBe(true);
});

test("pending_scope_selects_missing_plus_flagged_keys", async () => {
  // `flagged` alone selects NOTHING on a never-translated key — a missing key has no finding.
  // `pending` is missing ∪ flagged, which is what the dashboard's Translate button means.
  patchSend();
  const es = readJson(esPath);
  delete es.greet; // missing — invisible to `flagged`
  writeFileSync(esPath, JSON.stringify(es), "utf8");

  const r = await client.post("/v1/jobs", { json: { lang: "es", scope: "pending" } });
  expect(r.statusCode).toBe(202);
  const ws = getState().workspace;
  await ws.jobs.settled();
  expect(ws.jobs.status().state).toBe("done");

  const staged = new Set((await client.get("/v1/proposals", { params: { lang: "es" } })).json().proposals.map((p) => p.key));
  expect(staged.has("greet"), "the missing key must be in a pending run").toBe(true);
  expect(staged.has("common.no"), "the flagged key must be in a pending run").toBe(true);
});

test("flagged_scope_is_checked_and_flagged_only_a_missing_key_is_not_flagged", async () => {
  // The ruled semantics (2026-08-05, the original's intent): `flagged` = a finding on an
  // EXISTING translation. A key with no translation was never checked — it is `pending`
  // material and must NOT ride a flagged run.
  writeFileSync(esPath, JSON.stringify({ sidebar: { books: "Libros" }, common: { no: "Nop" } }), "utf8");
  const r = await client.post("/v1/jobs", { json: { lang: "es", scope: "flagged" } });
  expect(r.statusCode).toBe(400);
  expect(r.json().detail, "a lone missing key must leave `flagged` empty — it belongs to `pending`").toContain(
    "selected no keys",
  );
});

test("an_externally_changed_source_is_picked_up_without_a_restart", async () => {
  // audit 2026-08-05: the CLI's `extract` (or git, or an editor) writes new keys into en.json
  // UNDER a running server, and the load-once source cache kept reporting the old catalogue
  // until a restart. The route seam re-reads on mtime change.
  const enPath = join(dirname(dirname(configPath)), "src", "locales", "en.json");
  const en = readJson(enPath);
  en.docs = { intro: "Welcome to the manual" };
  writeFileSync(enPath, JSON.stringify(en), "utf8");
  // Filesystems with coarse mtime granularity need a nudge for the test.
  const t = Date.now() / 1000 + 2;
  utimesSync(enPath, t, t);

  const keys = (await client.get("/v1/rows")).json().rows.map((r) => r.key);
  expect(keys, "the new source key surfaces as work (missing)").toContain("docs.intro");
});

test("discarding_proposals_is_undoable_and_counts_honestly", async () => {
  // Discard destroys staged work by hand — so it records ONE undoable action (audit
  // 2026-08-05: it recorded nothing, and the next undo silently reversed some OLDER action
  // instead). The count is what was dropped, never keys.length.
  const p = getState().workspace.project;
  putProposal(p.state, { lang: "es", key: "common.no", engine: "e", value: "Nada" });
  putProposal(p.state, { lang: "es", key: "greet", engine: "e", value: "Buenas {name}" });

  const r = await client.request("DELETE", "/v1/proposals", { json: { lang: "es", keys: ["common.no", "nope-no-proposal"] } });
  expect(r.json().discarded, "a key with no proposal is not a discard").toBe(1);
  expect(new Set(proposals(p.state, { lang: "es" }).map((x) => x.key))).toEqual(new Set(["greet"]));

  await client.post("/v1/undo", { json: {} });
  const staged = proposals(p.state, { lang: "es" });
  expect(new Set(staged.map((x) => x.key))).toEqual(new Set(["greet", "common.no"]));
  expect(staged.find((x) => x.key === "common.no").value).toBe("Nada");
});

test("accepting_an_advisory_terminology_finding_is_recorded", async () => {
  // All findings are acceptable, advisory ones included (audit 2026-08-05): accept consulted
  // runChecks alone, so accepting a key whose ONE finding was the terminology sweep's
  // recorded nothing and the flag survived the click.
  const appDir = join(root, "termapp");
  mkdirSync(join(appDir, "src", "locales"), { recursive: true });
  writeFileSync(join(appDir, "package.json"), "{}", "utf8");
  const en = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [`w${i}`, `Window ${i}`]));
  const es = Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`w${i}`, `Ventana ${i}`]));
  es.w7 = "Cristal 7"; // the outlier the sweep flags (6/7 say Ventana)
  writeFileSync(join(appDir, "src", "locales", "en.json"), JSON.stringify(en), "utf8");
  writeFileSync(join(appDir, "src", "locales", "es.json"), JSON.stringify(es), "utf8");
  mkdirSync(join(appDir, "just-ai-i18n-docgen"));
  const config = join(appDir, "just-ai-i18n-docgen", "config.json");
  writeFileSync(config, JSON.stringify({ source: "../src/locales/en.json", targets: ["es"], context: "t" }), "utf8");
  const c = testClient(await createApp(join(root, "data2"), config));

  let w7 = (await c.get("/v1/rows")).json().rows.find((r) => r.key === "w7");
  expect(w7.flags.map((f) => f.code), "fixture sanity").toContain("terminology");

  const r = await c.post("/v1/accept", { json: { lang: "es", keys: ["w7"] } });
  expect(r.json().recorded, "the advisory finding IS recorded").toBeGreaterThanOrEqual(1);
  w7 = (await c.get("/v1/rows")).json().rows.find((r) => r.key === "w7");
  expect(w7 === undefined || !w7.flags.map((f) => f.code).includes("terminology"), "the accepted advisory finding leaves the page").toBe(true);
});

test("prompt_preview_carries_conventions_and_notes_like_the_real_run", async () => {
  // Preview fidelity (audit 2026-08-05): the Lab must show EXACTLY what a production run sends
  // — the per-language conventions line and the reviewer's per-key note were both dropped here
  // while the real run carried them.
  const es = readJson(esPath);
  delete es.greet; // pending → the sample picks it first
  writeFileSync(esPath, JSON.stringify(es), "utf8");
  await client.put("/v1/notes", { json: { lang: "es", key: "greet", note: "a greeting, not a farewell" } });

  const body = (await client.post("/v1/ai/prompt-preview", { json: { feature: "translate", lang: "es" } })).json();
  expect(body.user, "the note rides the preview").toContain("a greeting, not a farewell");
  expect(body.system, "the packaged es conventions line rides the preview system prompt").toContain(
    "Spanish punctuation is paired",
  );
});

test("an_edit_retires_the_stale_machine_opinions", async () => {
  // The writeKey contract: probe entry, cached reference, staged proposal and confirmation
  // verdict were all ABOUT the old text.
  const p = getState().workspace.project;
  writeFileSync(p.paths.probeFile("es"), JSON.stringify({ common: { no: "Nop" } }), "utf8");
  putProposal(p.state, { lang: "es", key: "common.no", engine: "e", value: "old proposal" });
  putReference(p.state, { lang: "es", key: "common.no", engine: "backtranslate", value: "No" });

  await client.post("/v1/save", { json: { lang: "es", key: "common.no", value: "Núm." } });

  expect(readJson(p.paths.probeFile("es")), "the probe entry about the old text is gone").toEqual({});
  expect(proposals(p.state, { lang: "es", key: "common.no" })).toEqual([]);
  expect(getReference(p.state, { lang: "es", key: "common.no", engine: "backtranslate" })).toBeNull();
});

test("setup_flow_no_project_then_inspect_then_save_goes_live", async () => {
  const r0 = tmpDir();
  const config = makeProject(r0);
  const enPath = join(dirname(dirname(config)), "src", "locales", "en.json");
  unlinkSync(config); // no project yet

  const c = testClient(await createApp(join(r0, "data")));
  // Project routes refuse with needsSetup; setup routes work.
  const r = await c.get("/v1/state");
  expect(r.statusCode).toBe(409);
  expect(r.json().detail.needsSetup).toBe(true);
  expect((await c.get("/v1/setup/state")).json().loaded).toBe(false);

  // Inspect reports what it found and writes NOTHING.
  const body = (await c.post("/v1/setup/inspect", { json: { path: enPath } })).json();
  expect(body.keyCount).toBe(3);
  expect(body.locales[0].code).toBe("es");
  expect(existsSync(config)).toBe(false);

  // Save writes the config and the page goes live WITHOUT a restart.
  const r2 = await c.post("/v1/setup/save", { json: { path: enPath, targets: ["es"], context: "a test app" } });
  expect(r2.json().ok).toBe(true);
  expect((await c.get("/v1/state")).json().langs).toEqual(["es"]);
  const cfg = readJson(config);
  expect(cfg.source).toBe("../src/locales/en.json");
  expect("engine" in cfg, "engines are presets in the shared DB now, never config").toBe(false);
});

test("setup_save_preserves_fields_it_does_not_manage", async () => {
  const r0 = tmpDir();
  const config = makeProject(r0);
  const cfg = readJson(config);
  cfg.myCustomField = { kept: true };
  writeFileSync(config, JSON.stringify(cfg), "utf8");

  const c = testClient(await createApp(join(r0, "data"), config));
  const enPath = join(dirname(dirname(config)), "src", "locales", "en.json");
  await c.post("/v1/setup/save", { json: { path: enPath, targets: ["es"] } });
  expect(readJson(config).myCustomField, "the UI is a writer, never an owner").toEqual({ kept: true });
});

test("terms_endpoint_answers_by_term", async () => {
  const body = (await client.get("/v1/terms", { params: { lang: "es", term: "books" } })).json();
  expect(body.term).toBe("books");
});

test("setup_state_glossary_is_always_a_bare_list", async () => {
  // The loaded cfg normalizes a list glossary to {"doNotTranslate": [...]} — the wire must
  // hand the UI a BARE LIST anyway. The dict on the wire blew up the Setup prefill spread and
  // let a Save erase the glossary (2026-08-05).
  const r0 = tmpDir();
  const config = makeProject(r0);
  const cfg = readJson(config);
  cfg.glossary = ["Strands", "TODO"];
  writeFileSync(config, JSON.stringify(cfg), "utf8");

  const c = testClient(await createApp(join(r0, "data"), config));
  expect((await c.get("/v1/setup/state")).json().glossary, "a bare list, never the dict").toEqual(["Strands", "TODO"]);
});

test("setup_save_without_glossary_preserves_the_existing_one", async () => {
  // A field the caller didn't send falls back to the EXISTING config's value — planInit's
  // defaults must never overwrite the real glossary through the merge (the erasure chain,
  // 2026-08-05).
  const r0 = tmpDir();
  const config = makeProject(r0);
  const cfg = readJson(config);
  cfg.glossary = ["Strands"];
  cfg.context = "the real context";
  writeFileSync(config, JSON.stringify(cfg), "utf8");

  const c = testClient(await createApp(join(r0, "data"), config));
  const enPath = join(dirname(dirname(config)), "src", "locales", "en.json");
  const r = await c.post("/v1/setup/save", { json: { path: enPath, targets: ["es"] } });
  expect(r.json().ok).toBe(true);
  const after = readJson(config);
  expect(after.glossary, "an omitted glossary is PRESERVED").toEqual(["Strands"]);
  expect(after.context, "an omitted context is PRESERVED").toBe("the real context");

  // And sending one explicitly still writes it.
  await c.post("/v1/setup/save", { json: { path: enPath, targets: ["es"], glossary: ["RAG"] } });
  expect(readJson(config).glossary).toEqual(["RAG"]);
});
