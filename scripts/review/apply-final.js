// SPDX-License-Identifier: MIT
// The last pass's rulings, through docgen's routes on the run's scratch-data server: each fix by
// POST /v1/save, then every accepted string by one POST /v1/accept (one undo), which records its
// docgen findings in <lang>.accepted.json under the run's reviewer (docs/dev/agentic-review.md).
//
//   node scripts/review/apply-final.js --dir <run> <project>
//        reads out/final-fix.json ([{project, key, action: "fix", value, …}]) and
//        out/final-accept.json ([{project, key, reason}])

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { docgenServer, loadRun, parseArgs } from "./run.js";

const args = parseArgs();
const run = loadRun(args.dir);
const project = args._[0];
if (!run.config(project)) throw new Error(`project must be one of ${run.projects.map((p) => p.id).join(", ")}`);
const read = (f) => (existsSync(resolve(run.dir, "out", f)) ? JSON.parse(readFileSync(resolve(run.dir, "out", f), "utf8")) : []);
const fixes = read("final-fix.json").filter((e) => e.project === project);
const accepts = read("final-accept.json").filter((e) => e.project === project);

const { call, stop } = await docgenServer(run, project);
try {
  let flagged = 0;
  for (const f of fixes) if ((await call("POST", "/v1/save", { lang: run.lang, key: f.key, value: f.value })).flags.length) flagged++;
  console.log(`[${project}] saved ${fixes.length} fixes (${flagged} still flagged by docgen)`);
  if (accepts.length) {
    const r = await call("POST", "/v1/accept", { lang: run.lang, keys: accepts.map((a) => a.key) });
    console.log(`[${project}] accepted ${r.keys.length} strings, ${r.recorded} findings recorded, by ${r.by}`);
  }
  const s = (await call("GET", "/v1/summary")).langs.find((l) => l.code === run.lang);
  console.log(`[${project}] summary: findings ${s.findings}, unreviewed ${s.unreviewed}, accepted ${s.accepted}, staged ${s.staged}, done ${s.done}/${s.total}`);
} finally {
  stop();
}
