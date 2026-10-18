// SPDX-License-Identifier: MIT
// What docgen still flags once the decisions are applied — the same sources its Review page uses
// (allFindings: the checks, the terminology sweep and the rest, less what <lang>.accepted.json
// already records as correct) — plus vue-i18n's compiler over every translated string, and the
// spellchecker over the strings this run changed: a fix or a B, or every string of a --new run
// (docs/dev/agentic-review.md). A string accepted before, and not changed since, isn't asked again.
//
//   node scripts/review/findings.js --dir <run>    → findings.md (the last agent's input), findings.json

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { allFindings, buildContext, compileErrors, loadRun, parseArgs, Project, speller, spellHints } from "./run.js";

const run = loadRun(parseArgs().dir);
const spell = await speller(run.lang);
const decFile = ["decisions-final.json", "decisions-review.json"].map((f) => resolve(run.dir, f)).find((f) => existsSync(f));
const decisions = new Map(decFile ? JSON.parse(readFileSync(decFile, "utf8")).map((e) => [`${e.project} ${e.key}`, e]) : []);
const onlyKeys = run.onlyNew ? new Set(JSON.parse(readFileSync(resolve(run.dir, "data.json"), "utf8")).map((r) => `${r.project} ${r.key}`)) : null;
const changed = new Set([...decisions].filter(([, d]) => d.action === "fix" || d.action === "B").map(([k]) => k));
const spellChecked = (project, key) => (onlyKeys ? onlyKeys.has(`${project} ${key}`) : changed.has(`${project} ${key}`));

const all = [];
for (const { id: project, config } of run.projects) {
  const p = new Project(config);
  const target = p.targetFlat(run.lang) ?? new Map();
  const glossary = (buildContext(p.cfg, p.conventions, run.lang).do_not_translate ?? []).map(String);
  const [found] = allFindings(p, run.lang, target, { topN: 1e9, includeTerms: true });
  const byKey = new Map();
  const add = (key, text) => {
    if (onlyKeys && !onlyKeys.has(`${project} ${key}`)) return; // a --new run looks at its own keys only
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(text);
  };
  for (const f of found) if (p.src.get(f.key)) add(f.key, `docgen ${f.code}${f.detail ? `: ${f.detail}` : ""}`);
  for (const [key, tr] of target) {
    if (typeof tr !== "string" || !p.src.get(key)) continue;
    for (const m of compileErrors(tr)) add(key, `vue-i18n ERROR: ${m}`);
    if (!spellChecked(project, key)) continue;
    const s = spellHints(spell, tr, p.src.get(key), glossary);
    if (s.length) add(key, `spellchecker doesn't know: ${s.join(", ")}`);
  }
  for (const [key, list] of byKey) {
    const d = decisions.get(`${project} ${key}`);
    all.push({ project, key, en: p.src.get(key), tr: target.get(key) ?? null, findings: list, decision: d ? `${d.action}${d.verified ? " (verified)" : ""} · ${d.reason}` : "A, not listed by its reviewer" });
  }
}
writeFileSync(resolve(run.dir, "findings.json"), JSON.stringify(all, null, 1));
writeFileSync(
  resolve(run.dir, "findings.md"),
  `# What is still flagged after the review — ${all.length} strings\n\n` +
    all
      .map((r, i) => [`## ${i + 1}. [${r.project}] ${r.key}`, `EN: ${JSON.stringify(r.en)}`, `${run.lang.toUpperCase()} (in the file now): ${JSON.stringify(r.tr)}`, `flagged: ${r.findings.join(" · ")}`, `how it got here: ${r.decision}`, ""].join("\n"))
      .join("\n"),
);
const codes = {};
for (const r of all) {
  for (const f of r.findings) {
    const c = f.startsWith("docgen ") ? f.slice(7).split(":")[0] : f.split(":")[0];
    codes[c] = (codes[c] ?? 0) + 1;
  }
}
console.log(JSON.stringify({ strings: all.length, perProject: Object.fromEntries(run.projects.map(({ id }) => [id, all.filter((r) => r.project === id).length])), codes }));
