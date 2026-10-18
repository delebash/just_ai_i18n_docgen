// SPDX-License-Identifier: MIT
// Merges the agents' part files into one decision per item (docs/dev/agentic-review.md).
//
//   node scripts/review/merge.js --dir <run> reviews [--verifiers 2]
//        → decisions-review.json, and verify-1.md … verify-N.md: every listed entry (each fix, each
//          B over A, each CHOOSE pick, each new translation) with the item's candidates and the
//          check's verdict on the text the entry would write — the verifiers' input
//   node scripts/review/merge.js --dir <run> final
//        → decisions-final.json: the reviews, overlaid by the verifiers' entries (and lead-*.json,
//          a lead's own mechanical fixes, last)

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { entryChecker } from "./check.js";
import { loadData, loadRun, parseArgs } from "./run.js";

const args = parseArgs();
const run = loadRun(args.dir);
const { data, byId } = loadData(run);
const problems = await entryChecker(run);
const id = (e) => `${e.project} ${e.key}`;
const read = (prefix) =>
  readdirSync(resolve(run.dir, "out"))
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .flatMap((f) => JSON.parse(readFileSync(resolve(run.dir, "out", f), "utf8")).map((e) => ({ ...e, file: f })));

function collect(prefix) {
  const out = new Map();
  const dupes = [];
  for (const e of read(prefix)) {
    if (out.has(id(e))) dupes.push(`${id(e)} (${out.get(id(e)).file}, ${e.file})`);
    out.set(id(e), e); // the later part file wins
  }
  return { entries: out, dupes };
}

const mode = args._[0];
if (mode !== "reviews" && mode !== "final") throw new Error("usage: merge.js --dir <run> reviews|final");
const { entries: reviews, dupes } = collect("review-");
const bad = [...reviews.values()].filter((e) => problems(e).some((p) => p.level === "error"));
const missing = data.filter((r) => (r.need === "choose" || r.need === "translate") && !reviews.has(id(r)));

if (mode === "reviews") {
  const nVerify = Number(args.verifiers || 2);
  const list = [...reviews.values()].sort((a, b) => byId.get(id(a)).batch - byId.get(id(b)).batch || byId.get(id(a)).n - byId.get(id(b)).n);
  const parts = Array.from({ length: nVerify }, (_, i) => list.slice(Math.round((i * list.length) / nVerify), Math.round(((i + 1) * list.length) / nVerify)));
  parts.forEach((part, vi) => {
    const lines = [];
    part.forEach((e, i) => {
      const r = byId.get(id(e));
      lines.push(`## ${i + 1}. [${e.project}] ${e.key}  (batch ${r.batch} item ${r.n}${r.need === "choose" ? ", CHOOSE" : r.need === "translate" ? ", NO CANDIDATE" : ""})`);
      lines.push(`EN: ${JSON.stringify(r.en)}`);
      if (r.cands.A !== undefined) lines.push(`A (docgen's proposal): ${JSON.stringify(r.cands.A)}`);
      if (r.cands.B !== undefined) lines.push(`B (in the file now): ${JSON.stringify(r.cands.B)}`);
      lines.push(`REVIEWER: ${e.action}${e.action === "fix" ? ` → ${JSON.stringify(e.value)}` : ""}${e.category ? ` · ${e.category}/${e.severity}` : ""} · ${e.reason}`);
      const ps = problems(e);
      if (ps.length) lines.push(`the check on the reviewer's text: ${ps.map((p) => `${p.level.toUpperCase()} ${p.text}`).join(" · ")}`);
      lines.push("");
    });
    writeFileSync(resolve(run.dir, `verify-${vi + 1}.md`), `# Verify ${vi + 1} — ${part.length} entries\n\n${lines.join("\n")}`);
  });
  writeFileSync(resolve(run.dir, "decisions-review.json"), JSON.stringify([...reviews.values()], null, 1));
}

if (mode === "final") {
  const { entries: verdicts, dupes: vd } = collect("verify-");
  for (const [k, e] of collect("lead-").entries) verdicts.set(k, e);
  dupes.push(...vd);
  const final = new Map(reviews);
  for (const [k, v] of verdicts) final.set(k, { ...v, verified: true, reviewer: reviews.get(k) ?? null });
  bad.push(...[...verdicts.values()].filter((e) => problems(e).some((p) => p.level === "error")));
  writeFileSync(resolve(run.dir, "decisions-final.json"), JSON.stringify([...final.values()], null, 1));
  const changed = [...verdicts.values()].filter((v) => {
    const r = reviews.get(id(v));
    return !r || r.action !== v.action || (v.action === "fix" && r.value !== v.value);
  });
  console.log(JSON.stringify({ verdicts: verdicts.size, changedByVerify: changed.length }));
}

const count = (f) => [...reviews.values()].filter(f).length;
console.log(
  JSON.stringify({
    reviewEntries: reviews.size,
    fix: count((e) => e.action === "fix"),
    A: count((e) => e.action === "A"),
    B: count((e) => e.action === "B"),
    bySeverity: Object.fromEntries(["critical", "major", "minor"].map((s) => [s, count((e) => e.severity === s)])),
    byCategory: Object.fromEntries(["accuracy", "fluency", "terminology", "locale", "format"].map((c) => [c, count((e) => e.category === c)])),
    malformedOrFailing: bad.map((e) => `${id(e)} (${e.file})`),
    missingRequired: missing.map((r) => `${r.project} ${r.key}`),
    duplicates: dupes,
  }),
);
process.exitCode = bad.length || missing.length ? 1 : 0;
