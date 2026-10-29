// SPDX-License-Identifier: MIT
// The e2e's own project (hermetic, app-structure §18 — the suite never reads or writes your real project): a small
// app with an English catalog and two languages. Spanish is part done, with two strings that came back identical
// (Review's findings) and two never translated; French is not started, with a run's output staged (Home's staged
// chip — a run stages proposals and never writes the locale file). Built in the driver's temp folder, so the
// driver's close removes it with everything else.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openProject, putProposal } from "../../server/src/state.js";

export const EN = {
  app: { hello: "Hello {name}", bye: "Bye", ok: "OK", title: "Settings", books: "Books" },
  nav: { home: "Home", help: "Help" },
};
const ES = { app: { hello: "Hola {name}", ok: "OK", title: "Ajustes" }, nav: { home: "Inicio", help: "Help" } };
/** French's staged run output. */
export const FR_STAGED = { "app.bye": "Au revoir", "app.ok": "OK" };

/** The fixture app under `root`; returns the path of its English catalog. The app carries its own package.json: the
 *  tool's folder is found by walking up to the nearest one (init.js findProjectRoot), so it stays inside `root`. */
export function makeFixture(root, { name = "e2e-fixture-app", staged = true } = {}) {
  const appRoot = path.join(root, name);
  const locales = path.join(appRoot, "src", "i18n", "locales");
  mkdirSync(locales, { recursive: true });
  writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name, private: true }));
  writeFileSync(path.join(locales, "en.json"), JSON.stringify(EN, null, 2));
  writeFileSync(path.join(locales, "es.json"), JSON.stringify(ES, null, 2));
  writeFileSync(path.join(locales, "fr.json"), "{}");
  if (staged) {
    // the workshop state beside the config Setup writes (<app>/just-ai-i18n-docgen/), as a run leaves it
    const tool = path.join(appRoot, "just-ai-i18n-docgen");
    mkdirSync(tool, { recursive: true });
    const state = openProject(tool);
    for (const [key, value] of Object.entries(FR_STAGED)) putProposal(state, { lang: "fr", key, engine: "translate", value });
  }
  return path.join(locales, "en.json");
}

/** The fixture made in the driver's temp folder and loaded into its server, the way Setup's Save loads a project. */
export async function loadFixture(d) {
  const enPath = makeFixture(path.join(d.tmp, "fixture"));
  const saved = await d.api("/setup/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: enPath, targets: ["es", "fr"], context: "an e2e fixture app" }),
  });
  if (saved?.ok !== true) throw new Error(`the fixture project didn't load: ${JSON.stringify(saved)}`);
  return enPath;
}
