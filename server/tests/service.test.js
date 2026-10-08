// SPDX-License-Identifier: MIT
// Port of tests/test_service.py — the translate service: the whole flow through a fake engine,
// on a real temp project.
//
// What must hold: the flow writes real files in the source's shape, the check is offline and
// deterministic, an acceptance flips the gate green AND expires with its strings, the
// confirmation pass annotates without ever signing off, and escalation spends the strong
// engine only on the keys that earned it while retiring their stale probe entries.
//
// Python's monkeypatch of `service.require_probe_temperature` / `service.make_send` is
// `vi.spyOn(service, …)` (the module calls both through `self.`).
//
// One JS difference by design: the result keys are camelCase (`hardFailures`, `probeMoved`),
// as every JS name — they never reach the wire.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import * as service from "../src/service.js";
import { acceptKeys, allFindings, Project, runCheck, runEscalate, runTranslate } from "../src/service.js";
import { confirmations, putConfirmation } from "../src/state.js";
import { tmpDir } from "./helpers.js";

const EN = { greet: "Hello {name}", sidebar: { books: "Books" }, common: { no: "No" } };
const itemsOf = (user) => JSON.parse(/Translate items: (\[.*\])$/s.exec(user)[1]);

/** Deterministic engine: real Spanish for the two translatable keys, the cognate left
 * identical — the shape of a real catalogue. */
function fakeSend(_system, user) {
  const answers = { "Hello ⟦0⟧": "Hola ⟦0⟧", Books: "Libros", No: "No" };
  return JSON.stringify({ items: itemsOf(user).map((it) => ({ id: it.id, translation: answers[it.text] ?? `XX ${it.text}` })) });
}

function makeProject() {
  const root = tmpDir();
  const toolDir = join(root, "app", "just-ai-i18n-docgen");
  const locales = join(root, "app", "src", "locales");
  mkdirSync(toolDir, { recursive: true });
  mkdirSync(locales, { recursive: true });
  writeFileSync(join(locales, "en.json"), JSON.stringify(EN), "utf8");
  const config = join(toolDir, "config.json");
  writeFileSync(config, JSON.stringify({ source: "../src/locales/en.json", targets: ["es"], context: "a test app", glossary: [] }), "utf8");
  return new Project(config);
}

const quiet = () => {};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("translate_writes_the_locale_file_in_source_shape", async () => {
  const project = makeProject();
  const result = await runTranslate(project, { send: fakeSend, noConfirm: true, log: quiet });
  expect(result.hardFailures).toBe(0);
  expect(readJson(project.paths.targetFile("es"))).toEqual({ greet: "Hola {name}", sidebar: { books: "Libros" }, common: { no: "No" } });
  expect(existsSync(project.paths.cachePath), "the cache landed beside the config").toBe(true);
});

test("check_is_offline_and_the_cognate_costs_one_finding", async () => {
  const project = makeProject();
  await runTranslate(project, { send: fakeSend, noConfirm: true, log: quiet });
  const check = runCheck(project, { log: quiet });
  // "No" -> "No" raises untranslated — the correct answer, flagged. This is exactly why
  // acceptances exist; a perfect catalogue must be able to reach green.
  expect(check.failed).toBe(1);
  expect(check.langs.es.findings.map((f) => f.code)).toEqual(["untranslated"]);
});

test("accept_flips_the_gate_green_and_expires_with_the_source", async () => {
  const project = makeProject();
  await runTranslate(project, { send: fakeSend, noConfirm: true, log: quiet });
  // A machine verdict sits on the key; the CLI accept must retire it like the workspace door
  // does (audit 2026-08-05: it didn't — stale pre-ticks).
  putConfirmation(project.state, { lang: "es", key: "common.no", hash: "h-stale", verdict: "same", engine: "e" });
  const result = acceptKeys(project, ["common.no"], { by: "tester", log: quiet });
  expect(result).toEqual({ recorded: 1, reviewer: "tester" });
  expect(confirmations(project.state, "es")["common.no"], "the CLI accept retires the machine verdict").toBeUndefined();
  expect(runCheck(project, { log: quiet }).failed, "the gate CAN go green").toBe(0);
  const accepted = readJson(project.paths.acceptedFile("es"));
  expect(Object.values(accepted)[0].by, "the verdict carries the human's name").toBe("tester");

  // BITES: the pair changes — the same key now holds a DIFFERENT identical pair
  // ("Yes"/"Yes"), so untranslated fires again and the old No/No acceptance must NOT cover
  // it. An acceptance is a statement about one exact pair of strings, never a standing
  // exemption for a key.
  writeFileSync(project.paths.sourceFile, JSON.stringify({ ...EN, common: { no: "Yes" } }), "utf8");
  const es2 = readJson(project.paths.targetFile("es"));
  es2.common.no = "Yes";
  writeFileSync(project.paths.targetFile("es"), JSON.stringify(es2), "utf8");
  const reloaded = new Project(project.configPath);
  const [findings, acceptedNow] = allFindings(reloaded, "es", reloaded.targetFlat("es"));
  expect(findings.some((f) => f.key === "common.no" && f.code === "untranslated")).toBe(true);
  expect(acceptedNow).toEqual([]);
});

test("confirmation_pass_annotates_and_never_touches_the_accepted_file", async () => {
  const project = makeProject();
  await runTranslate(project, { send: fakeSend, ask: () => "SAME", log: quiet });
  // The verdict landed in WORKSHOP STATE and pre-ticks the finding…
  const [findings] = allFindings(project, "es", project.targetFlat("es"));
  const identical = findings.find((f) => f.key === "common.no");
  expect(identical.confirmed).toBe("same");
  // …but the finding still COUNTS, and the human record was never written: the engine never
  // signs off.
  expect(runCheck(project, { log: quiet }).failed).toBe(1);
  expect(existsSync(project.paths.acceptedFile("es"))).toBe(false);
});

test("confirmation_proposals_are_shown_never_applied", async () => {
  const project = makeProject();
  await runTranslate(project, { send: fakeSend, ask: () => "Núm.", log: quiet });
  const [findings] = allFindings(project, "es", project.targetFlat("es"));
  const identical = findings.find((f) => f.key === "common.no");
  expect(identical.confirmed).toBe("translate");
  expect(identical.suggestion).toBe("Núm.");
  expect(readJson(project.paths.targetFile("es")).common.no, "the suggestion did NOT reach the locale file").toBe("No");
});

test("probe_writes_its_sidecar_and_disagreements_are_advisory", async () => {
  // The guard is the engine seam's job and has its own test; a unit-level probe run must not
  // need the whole shared stack booted.
  vi.spyOn(service, "requireProbeTemperature").mockImplementation(() => {});
  const project = makeProject();
  const calls = { n: 0 };
  const twoMinds = (system, user) => {
    calls.n += 1;
    const out = fakeSend(system, user);
    // The second pass words one key differently — the model wandering where unsure.
    return calls.n > 1 ? out.replace("Libros", "Los libros") : out;
  };
  const result = await runTranslate(project, { send: twoMinds, probe: true, noConfirm: true, log: quiet });
  expect(existsSync(project.paths.probeFile("es"))).toBe(true);
  expect(result.langs.es.probeMoved).toBe(1);

  const check = runCheck(project, { log: quiet });
  expect(new Set(check.langs.es.findings.map((f) => f.code)).has("disagreement")).toBe(true);
  // Advisory: only the cognate's untranslated counts toward failure, never suspicion.
  expect(check.failed).toBe(1);
});

test("zero_probe_movement_is_reported_as_instrument_trouble", async () => {
  vi.spyOn(service, "requireProbeTemperature").mockImplementation(() => {});
  const project = makeProject();
  const logs = [];
  await runTranslate(project, { send: fakeSend, probe: true, noConfirm: true, log: (l) => logs.push(l) });
  expect(
    logs.some((l) => l.includes("agreed on EVERY key")),
    "a probe that finds nothing must say 'suspect the instrument', not look clean",
  ).toBe(true);
});

test("escalate_redoes_only_flagged_keys_and_retires_their_probe_entries", async () => {
  const project = makeProject();
  await runTranslate(project, { send: fakeSend, noConfirm: true, log: quiet });
  // A probe sidecar with a disagreement on the flagged key AND one on a healthy key.
  writeFileSync(project.paths.probeFile("es"), JSON.stringify({ common: { no: "Nop" }, sidebar: { books: "Los libros" } }), "utf8");

  const sentTexts = [];
  const strongSend = (_system, user) => {
    const items = itemsOf(user);
    sentTexts.push(...items.map((it) => it.text));
    return JSON.stringify({ items: items.map((it) => ({ id: it.id, translation: `ES ${it.text}` })) });
  };
  vi.spyOn(service, "makeSend").mockImplementation(() => strongSend);
  const out = await runEscalate(project, "p_strong", { log: quiet });

  // Only the flagged keys were spent on the strong engine: the cognate (untranslated) and the
  // two disagreement suspects — never the healthy greet key.
  expect(sentTexts).not.toContain("Hello ⟦0⟧");
  expect(out.es.before).toBeGreaterThanOrEqual(2);
  // The redone keys' probe entries are retired; comparing a strong answer to the weak
  // engine's probe would flag them forever.
  expect(readJson(project.paths.probeFile("es")), "every escalated key's probe entry was dropped").toEqual({});
});

test("a_failing_engine_yields_hard_failures_and_a_named_key", async () => {
  const project = makeProject();
  const brokenSend = () => {
    throw new Error("engine offline");
  };
  const result = await runTranslate(project, { send: brokenSend, noConfirm: true, log: quiet });
  expect(result.hardFailures).toBe(project.src.size);
  expect([...result.langs.es.failed].sort()).toEqual([...project.src.keys()].sort());
});
