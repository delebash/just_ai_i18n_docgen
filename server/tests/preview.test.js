// SPDX-License-Identifier: MIT
// Port of tests/test_preview.py — the prompt-preview seam behind POST /v1/ai/prompt-preview:
// the REAL builders over a small live sample — shielding included — with loud, NAMED empties.
// The kit's promptless Lab renders exactly these strings, so what the reviewer tunes is what
// production sends.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HttpError } from "@delebash/llm-runner/platform/errors";
import { expect, test } from "vitest";
import { Project } from "../src/service.js";
import { _pickPreviewLang, _previewConfirm, _previewTranslate } from "../src/workspace.js";
import { tmpDir } from "./helpers.js";

const EN = { app: { hello: "Hello {name}", books: "Books" }, common: { no: "No" } };

function makeProject(targets = ["es"], extra = { context: "a test app" }) {
  const root = tmpDir();
  const toolDir = join(root, "app", "tool");
  const locales = join(root, "app", "src", "locales");
  mkdirSync(toolDir, { recursive: true });
  mkdirSync(locales, { recursive: true });
  writeFileSync(join(locales, "en.json"), JSON.stringify(EN), "utf8");
  const config = join(toolDir, "config.json");
  writeFileSync(config, JSON.stringify({ source: "../src/locales/en.json", targets, glossary: [], ...extra }), "utf8");
  return new Project(config);
}

function writeTarget(project, values, lang = "es") {
  const p = project.paths.targetFile(lang);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(values), "utf8");
}

test("translate_preview_is_the_real_shielded_prompt", () => {
  const out = _previewTranslate(makeProject(), "es", null);
  expect(out.system, "the system prompt names the target language").toContain("es");
  // The placeholder is SHIELDED: the model sees the token, never the raw {name} — the same
  // substitution a production batch performs.
  expect(out.user).not.toContain("{name}");
  expect(out.user).toContain("Translate items:");
  expect(out.sample).toBe("3 pending key(s) · es");
});

test("translate_preview_honours_requested_keys", () => {
  const out = _previewTranslate(makeProject(), "es", ["common.no"]);
  expect(out.user).not.toContain('"Books"');
  expect(out.user).toContain("No");
  expect(out.sample).toBe("1 pending key(s) · es");
});

test("translate_preview_samples_done_keys_when_finished", () => {
  // A FINISHED language still shows the Lab (ruling 2026-08-04: 'def show the full lab') —
  // the preview samples already-translated keys and SAYS so; the prompt is still the real
  // shielded one.
  const project = makeProject();
  writeTarget(project, { app: { hello: "Hola x", books: "Libros" }, common: { no: "No" } });
  const out = _previewTranslate(project, "es", null);
  expect(out.sample).toContain("every key translated");
  expect(out.sample).toContain("done key(s)");
  expect(out.user, "the fallback sample is still shielded").not.toContain("{name}");
});

test("confirm_preview_falls_back_when_nothing_identical", () => {
  // A fresh project (nothing translated, nothing identical) still renders the Lab — the probe
  // prompt's SHAPE is identical over any key; the sample names the fallback.
  const out = _previewConfirm(makeProject(), "es", null);
  expect(out.sample).toContain("nothing translated yet");
  expect(out.system).toContain("SAME");
});

test("confirm_preview_requested_keys_stay_loud", () => {
  // Explicit keys never silently fall back — asking for a specific key that is not
  // byte-identical is answered with the named 400.
  const project = makeProject();
  writeTarget(project, { common: { no: "Não" } });
  let err;
  try {
    _previewConfirm(project, "es", ["common.no"]);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(HttpError);
  expect(String(err.detail).toLowerCase()).toContain("requested");
});

test("preview_lang_default_is_the_busiest", () => {
  // A922's agreed default: no lang given → the BUSIEST target. Translate = most pending;
  // confirm = most byte-identical, then most translated.
  const p = makeProject(["es", "fr"], { context: "" });
  // es fully translated (one byte-identical), fr untouched → translate goes to fr, confirm
  // goes to es.
  writeTarget(p, { app: { hello: "Hola x", books: "Libros" }, common: { no: "No" } });
  expect(_pickPreviewLang(p, "translate")).toBe("fr");
  expect(_pickPreviewLang(p, "confirm")).toBe("es");
});

test("confirm_preview_asks_about_the_identical_key", () => {
  const project = makeProject();
  writeTarget(project, { common: { no: "No" } });
  const out = _previewConfirm(project, "es", null);
  expect(out.system, "the probe prompt names the SAME verdict explicitly").toContain("SAME");
  expect(out.user, "one key per call, the makeAsk shape").toContain('"text": "No"');
  expect(out.sample).toContain("common.no");
});
