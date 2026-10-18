// SPDX-License-Identifier: MIT
// Applies the review's decisions to one project through docgen's own routes, on a scratch-data
// docgen server (run.js docgenServer). Afterwards the language's file must equal what the
// decisions say, key by key (docs/dev/agentic-review.md).
//
//   node scripts/review/apply.js --dir <run> <project> [--dry-run]
//
// A — POST /v1/proposals/apply (one bulk-apply undo); a fix — POST /v1/save per key (an edit undo
// each, marked reviewed); then DELETE /v1/proposals for every B and fix that had a proposal (one
// bulk-discard undo), so nothing stays staged. Decisions: decisions-final.json once the verifiers
// have run, else decisions-review.json.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { docgenServer, loadData, loadRun, parseArgs, Project } from "./run.js";

const args = parseArgs();
const run = loadRun(args.dir);
const project = args._[0];
if (!run.config(project)) throw new Error(`project must be one of ${run.projects.map((p) => p.id).join(", ")}`);
const { data: all } = loadData(run);
const data = all.filter((r) => r.project === project);
const decisionsFile = existsSync(resolve(run.dir, "decisions-final.json")) ? "decisions-final.json" : "decisions-review.json";
const decisions = new Map(JSON.parse(readFileSync(resolve(run.dir, decisionsFile), "utf8")).filter((e) => e.project === project).map((e) => [e.key, e]));
const plan = data.map((r) => {
  const d = decisions.get(r.key);
  const action = d?.action ?? (r.cands.A !== undefined ? "A" : "B");
  const value = action === "fix" ? d.value : r.cands[action];
  if (typeof value !== "string" || value === "") throw new Error(`no value for [${project}] ${r.key} (${action})`);
  return { key: r.key, action, value, hasProposal: r.cands.A !== undefined };
});
const keysOf = (f) => plan.filter(f).map((p) => p.key);
const applyKeys = keysOf((p) => p.action === "A");
const fixes = plan.filter((p) => p.action === "fix");
const discardKeys = keysOf((p) => p.action !== "A" && p.hasProposal);
console.log(JSON.stringify({ project, decisionsFile, items: plan.length, apply: applyKeys.length, save: fixes.length, keepFile: keysOf((p) => p.action === "B").length, discard: discardKeys.length }));
if (args["dry-run"]) process.exit(0);

const { call, stop } = await docgenServer(run, project);
try {
  if (applyKeys.length) console.log("applied:", (await call("POST", "/v1/proposals/apply", { lang: run.lang, keys: applyKeys })).applied.length);
  let flagged = 0;
  for (const f of fixes) if ((await call("POST", "/v1/save", { lang: run.lang, key: f.key, value: f.value })).flags.length) flagged++;
  console.log("saved:", fixes.length, "with docgen flags:", flagged);
  if (discardKeys.length) console.log("discarded:", (await call("DELETE", "/v1/proposals", { lang: run.lang, keys: discardKeys })).discarded);
  console.log("summary:", JSON.stringify((await call("GET", "/v1/summary")).langs.find((l) => l.code === run.lang)));
  const target = new Project(run.config(project)).targetFlat(run.lang);
  const wrong = plan.filter((p) => target.get(p.key) !== p.value).map((p) => p.key);
  console.log(wrong.length ? `MISMATCH in ${wrong.length} keys: ${wrong.slice(0, 10).join(", ")}` : `${run.lang}.json matches the decisions in all ${plan.length} keys`);
  process.exitCode = wrong.length ? 1 : 0;
} finally {
  stop();
}
