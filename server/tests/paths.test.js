// SPDX-License-Identifier: MIT
// Port of tests/test_paths.py — path resolution: everything anchors to the CONFIG FILE, never
// the working directory. The Node original's test ran the resolver from an unrelated
// directory so the cwd bug (27 minutes and 464 hand-corrected keys, 2026-07-31) cannot come
// back; so does this one (vitest runs files in forked processes, so chdir stays local).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { projectPaths } from "../src/paths.js";
import { tmpDir } from "./helpers.js";

// EVERY test here runs from an unrelated directory — the resolver must not care.
let cwd;
beforeEach(() => {
  cwd = process.cwd();
  process.chdir(tmpDir("unrelated-cwd-"));
});
afterEach(() => process.chdir(cwd));

function project(cfg) {
  const app = join(tmpDir(), "app");
  mkdirSync(join(app, "just-ai-i18n-docgen"), { recursive: true });
  mkdirSync(join(app, "src", "i18n", "locales"), { recursive: true });
  writeFileSync(join(app, "src", "i18n", "locales", "en.json"), "{}", "utf8");
  const config = join(app, "just-ai-i18n-docgen", "config.json");
  writeFileSync(config, JSON.stringify(cfg), "utf8");
  return config;
}

test("source_shaped_config_one_field_three_facts", () => {
  const config = project({ source: "../src/i18n/locales/en.json" });
  const p = projectPaths(config, { source: "../src/i18n/locales/en.json" });
  expect(p.sourceLanguage).toBe("en");
  expect(p.sourceFile.endsWith("en.json")).toBe(true);
  expect(p.localesDir).toBe(dirname(p.sourceFile));
  expect(p.targetFile("es")).toBe(join(p.localesDir, "es.json"));
});

test("point_it_at_es_and_spanish_is_the_source", () => {
  // sourceLanguage used to default to "en" invisibly; the FILENAME is the fact now.
  const config = project({ source: "../src/i18n/locales/es.json" });
  expect(projectPaths(config, { source: "../src/i18n/locales/es.json" }).sourceLanguage).toBe("es");
});

test("legacy_folder_shaped_config_still_works", () => {
  const config = project({ locales: "../src/i18n/locales", sourceLanguage: "en" });
  const p = projectPaths(config, { locales: "../src/i18n/locales", sourceLanguage: "en" });
  expect(p.sourceFile).toBe(join(p.localesDir, "en.json"));
  expect(p.sourceLanguage).toBe("en");
});

test("a_config_naming_nothing_fails_loudly", () => {
  const config = project({});
  expect(() => projectPaths(config, {})).toThrow(/source/);
});

test("sidecars_sit_beside_the_config_and_cache_anchors_there_too", () => {
  const config = project({ source: "../src/i18n/locales/en.json" });
  const p = projectPaths(config, { source: "../src/i18n/locales/en.json" });
  const configDir = dirname(p.cachePath);
  expect(p.sidecarDir).toBe(configDir);
  expect(p.acceptedFile("es")).toBe(join(configDir, "es.accepted.json"));
  expect(p.cachePath).toBe(join(configDir, ".just-ai-i18n-docgen-cache.json"));
  expect(configDir.toLowerCase()).toBe(dirname(config).toLowerCase());
});

test("legacy_sidecars_in_locales_win_so_an_upgrade_orphans_nothing", () => {
  const config = project({ source: "../src/i18n/locales/en.json" });
  const locales = join(dirname(dirname(config)), "src", "i18n", "locales");
  // A pre-2026-07-31 project keeps its verdicts in locales/ — that location wins, decided
  // ONCE for the whole project so sidecars for one language stay together.
  writeFileSync(join(locales, "es.accepted.json"), "{}", "utf8");
  const p = projectPaths(config, { source: "../src/i18n/locales/en.json" });
  expect(p.sidecarDir).toBe(p.localesDir);
  expect(p.notesFile("es")).toBe(join(p.localesDir, "es.notes.json"));
});
