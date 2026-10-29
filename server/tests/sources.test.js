// SPDX-License-Identifier: MIT
// What English each translation was made from (sources.js, 2026-10-29): the CLI's translate keeps a
// reviewed string when the project's context or glossary changes — it used to write over all of
// them — and a changed English string is found (`source-changed`), re-translated by the CLI, and
// answered by a Save or an accept.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { allFindings, Project, runTranslate } from "../src/service.js";
import { loadSources, SOURCE_CHANGED } from "../src/sources.js";
import { tmpDir } from "./helpers.js";

// the batch the loop sends: the translate row's {{items}} (shieldlib.js translateVariables)
const itemsOf = (vars) => JSON.parse(vars.items);
const quiet = () => {};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** An engine that answers "NEW <text>" and counts what it was sent. */
function countingEngine() {
  const sent = [];
  const send = (vars) => {
    const items = itemsOf(vars);
    for (const it of items) sent.push(it.text);
    return JSON.stringify({ items: items.map((it) => ({ id: it.id, translation: `NEW ${it.text}` })) });
  };
  return { send, sent };
}

/** A project whose es.json was reviewed already. */
function reviewedProject() {
  const root = tmpDir();
  const toolDir = join(root, "app", "just-ai-i18n-docgen");
  const locales = join(root, "app", "src", "locales");
  mkdirSync(toolDir, { recursive: true });
  mkdirSync(locales, { recursive: true });
  writeFileSync(join(locales, "en.json"), JSON.stringify({ save: "Save", open: "Open" }), "utf8");
  writeFileSync(join(locales, "es.json"), JSON.stringify({ save: "Guardar", open: "Abrir" }), "utf8");
  const config = join(toolDir, "config.json");
  writeFileSync(config, JSON.stringify({ source: "../src/locales/en.json", targets: ["es"], context: "an app", glossary: [] }), "utf8");
  return { config, en: join(locales, "en.json"), es: join(locales, "es.json") };
}

test("a reviewed catalogue survives a changed context: the CLI's translate sends nothing", async () => {
  const { config, es } = reviewedProject();
  const engine = countingEngine();
  await runTranslate(new Project(config), { send: engine.send, noConfirm: true, log: quiet });
  expect(engine.sent).toEqual([]);
  // the context sentence changes — before 2026-10-29 this re-translated and wrote over every key
  const cfg = readJson(config);
  writeFileSync(config, JSON.stringify({ ...cfg, context: "a different sentence about the app" }), "utf8");
  await runTranslate(new Project(config), { send: engine.send, noConfirm: true, log: quiet });
  expect(engine.sent).toEqual([]);
  expect(readJson(es)).toEqual({ save: "Guardar", open: "Abrir" });
});

test("a changed English string is a source-changed finding, and the CLI re-translates exactly it", async () => {
  const { config, en, es } = reviewedProject();
  // first sight: the existing translations are taken as made from today's English
  let project = new Project(config);
  expect(allFindings(project, "es", project.targetFlat("es"))[0].filter((f) => f.code === SOURCE_CHANGED)).toEqual([]);
  expect(loadSources(project.paths.cachePath).es).toEqual({ save: "Save", open: "Open" });

  writeFileSync(en, JSON.stringify({ save: "Save changes", open: "Open" }), "utf8");
  project = new Project(config);
  const [found] = allFindings(project, "es", project.targetFlat("es"));
  const changed = found.filter((f) => f.code === SOURCE_CHANGED);
  expect(changed).toEqual([{ key: "save", code: SOURCE_CHANGED, detail: "Save" }]);

  const engine = countingEngine();
  await runTranslate(project, { send: engine.send, noConfirm: true, log: quiet });
  expect(engine.sent, "only the changed key goes to the engine").toEqual(["Save changes"]);
  expect(readJson(es)).toEqual({ save: "NEW Save changes", open: "Abrir" });
  // and its record follows: no finding left
  project = new Project(config);
  expect(allFindings(project, "es", project.targetFlat("es"))[0].filter((f) => f.code === SOURCE_CHANGED)).toEqual([]);
});
