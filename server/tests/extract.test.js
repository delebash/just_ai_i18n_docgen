// SPDX-License-Identifier: MIT
// Port of tests/test_extract.py. The extractor OWNS two prefixes in the source locale and
// must not touch anything else. Both halves are dangerous if wrong: a generator that clobbers
// hand-written copy is one nobody dares run, and one that leaves deleted hints behind ships
// text to nine languages that no document says any more. Ported from just-ai-help's
// `test/extract.test.js` plus the front-matter parser's own biting cases.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { runExtract } from "../src/extract.js";
import { parseFrontMatter } from "../src/frontmatter.js";
import { Project } from "../src/service.js";
import { tmpDir } from "./helpers.js";

const quiet = () => {};

function fixture({ docs, en }) {
  const root = tmpDir();
  const docsDir = join(root, "docs");
  const locales = join(root, "locales");
  mkdirSync(docsDir);
  mkdirSync(locales);
  for (const [name, text] of Object.entries(docs)) writeFileSync(join(docsDir, name), text, "utf8");
  writeFileSync(join(locales, "en.json"), `${JSON.stringify(en, null, 2)}\n`, "utf8");
  const config = join(root, "config.json");
  writeFileSync(config, JSON.stringify({ source: "locales/en.json", targets: [], docsDir: "docs" }), "utf8");
  return config;
}

const enPath = (config) => join(dirname(config), "locales", "en.json");
const readEn = (config) => JSON.parse(readFileSync(enPath(config), "utf8"));

const FM = ["---", "lede: The heart of the app.", "hints:", "  status: Whether it is done.", "---", "# Writing"].join("\n");

test("extracts_lede_and_hints_keyed_by_slug_and_leaves_handwritten_keys_alone", () => {
  const config = fixture({ docs: { "writing.md": FM }, en: { common: { save: "Save" } } });
  runExtract(new Project(config), { log: quiet });
  const en = readEn(config);
  expect(en.lede.writing).toBe("The heart of the app.");
  expect(en.hints.writing.status).toBe("Whether it is done.");
  expect(en.common.save).toBe("Save");
});

test("bites_a_hint_deleted_from_the_doc_is_removed_from_the_locale", () => {
  const two = ["---", "hints:", "  a: One.", "  b: Two.", "---", "# W"].join("\n");
  const config = fixture({ docs: { "writing.md": two }, en: {} });
  runExtract(new Project(config), { log: quiet });
  expect(readEn(config).hints.writing.b).toBe("Two.");

  writeFileSync(join(dirname(config), "docs", "writing.md"), ["---", "hints:", "  a: One.", "---", "# W"].join("\n"), "utf8");
  runExtract(new Project(config), { log: quiet });
  const en = readEn(config);
  expect(en.hints.writing.a).toBe("One.");
  expect("b" in en.hints.writing, "a deleted hint must not linger").toBe(false);
});

test("bites_check_reports_stale_and_writes_nothing", () => {
  const config = fixture({ docs: { "writing.md": FM }, en: { common: { save: "Save" } } });
  const before = readFileSync(enPath(config), "utf8");
  const result = runExtract(new Project(config), { check: true, log: quiet });
  expect(result.stale).toBe(true);
  expect(readFileSync(enPath(config), "utf8"), "--check must not write").toBe(before);
  runExtract(new Project(config), { log: quiet }); // make it current
  expect(runExtract(new Project(config), { check: true, log: quiet }).stale).toBe(false);
});

test("bites_a_broken_doc_fails_the_run_and_names_the_file", () => {
  const bad = ["---", "hints:", "\tstatus: Tabbed.", "---", "# Bad"].join("\n");
  const config = fixture({ docs: { "bad.md": bad }, en: {} });
  expect(() => runExtract(new Project(config), { log: quiet })).toThrow(/bad\.md.*tabs/);
});

test("docs_with_no_front_matter_are_simply_skipped", () => {
  const config = fixture({
    docs: { "plain.md": "# Plain\n\nJust prose.\n", "withfm.md": ["---", "lede: Yes.", "---", "# X"].join("\n") },
    en: {},
  });
  runExtract(new Project(config), { log: quiet });
  const en = readEn(config);
  expect(en.lede.withfm).toBe("Yes.");
  expect("plain" in en.lede).toBe(false);
});

test("a_flat_locale_with_dotted_keys_is_not_restructured", () => {
  const config = fixture({
    docs: { "writing.md": ["---", "lede: Text.", "---", "# W"].join("\n") },
    en: { "common.save": "Save", "common.cancel": "Cancel" },
  });
  runExtract(new Project(config), { log: quiet });
  const en = readEn(config);
  expect(en["common.save"], "existing flat keys must stay flat").toBe("Save");
  expect(en["lede.writing"], "generated keys follow the file's own shape").toBe("Text.");
  expect("lede" in en, "must not nest into a file that is flat").toBe(false);
});

// ── the parser's own refusals — succeed-and-drop is the failure mode ─────────

test("parser_refuses_what_it_does_not_understand", () => {
  for (const [text, why] of [
    ["---\nlede: |\n  multi\n---\nbody", /multi-line/],
    ["---\n- item\n---\nbody", /lists/],
    ["---\nhints:\n  deep:\n    more: x\n---\nbody", /deeper than one level/],
    ["---\nlede: a\nlede: b\n---\nbody", /duplicate/],
    ["---\nlede: a\n", /no closing/],
    ["---\n  orphan: x\n---\nbody", /no parent/],
  ]) {
    expect(() => parseFrontMatter(text)).toThrow(why);
  }
});

test("parser_handles_quotes_comments_and_no_fence", () => {
  let [data, body] = parseFrontMatter('---\nlede: "Quoted: with a colon."\n# a comment\nhints:\n  a: x\n---\n# Body\n');
  expect(data).toEqual(
    new Map([
      ["lede", "Quoted: with a colon."],
      ["hints", new Map([["a", "x"]])],
    ]),
  );
  expect(body.startsWith("# Body")).toBe(true);
  [data, body] = parseFrontMatter("# Just a doc\n");
  expect(data.size === 0 && body === "# Just a doc\n").toBe(true);
});
