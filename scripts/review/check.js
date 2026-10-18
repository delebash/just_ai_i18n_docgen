// SPDX-License-Identifier: MIT
// The review's own check, for the agents and for every later step (docs/dev/agentic-review.md).
//
//   node scripts/review/check.js --dir <run> <file.json> [<file.json> …]
//        entries: [{n, project, key, action: "A"|"B"|"fix", value?, category?, severity?, reason}]
//   node scripts/review/check.js --dir <run> --coverage <batch>
//        the batch's CHOOSE and NO CANDIDATE items that no entry lists yet
//
// For each entry: is it well formed and about a real item, and does the text it would write pass
// docgen's checks, vue-i18n's message compiler and the spellchecker (run.js checker)? One line per
// problem; exit 1 when an entry is malformed or fails docgen's checks or the compiler (spelling is
// a hint, and four docgen codes are warnings the reason must answer). A file named without a
// folder is read from the run folder.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checker, inRun, loadData, loadRun, parseArgs } from "./run.js";

/** problems(entry) for one run → [{level: "error"|"warn"|"hint", text}]. */
export async function entryChecker(run) {
  const { byId } = loadData(run);
  const check = await checker(run);
  return (e) => {
    const out = [];
    const err = (text) => out.push({ level: "error", text });
    if (!e || typeof e !== "object") return [{ level: "error", text: "not an object" }];
    const r = byId.get(`${e.project} ${e.key}`);
    if (!r) return [{ level: "error", text: `no such item: [${e.project}] ${e.key}` }];
    if (e.n !== undefined && e.n !== r.n) err(`n is ${e.n}, but this key is item ${r.n} of batch ${r.batch}`);
    if (!["A", "B", "fix"].includes(e.action)) err(`action must be "A", "B" or "fix", not ${JSON.stringify(e.action)}`);
    if (e.action === "A" && r.cands.A === undefined) err("there is no A for this item");
    if (e.action === "B" && r.cands.B === undefined) err("there is no B for this item");
    if (e.action === "fix" && (typeof e.value !== "string" || e.value === "")) err("a fix needs a non-empty value");
    if (e.action !== "fix" && e.value !== undefined && e.value !== null) err("only a fix carries a value");
    if (typeof e.reason !== "string" || !e.reason) err("reason is missing");
    if (out.length) return out;
    const value = e.action === "fix" ? e.value : r.cands[e.action];
    if (e.action === "fix" && value === r.cands.A) err("this fix is identical to A; use action A");
    if (e.action === "fix" && value === r.cands.B) err("this fix is identical to B; use action B");
    return [...out, ...check(e.project, e.key, r.en, value)];
  };
}

const listed = (r) => r.need === "choose" || r.need === "translate";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  const run = loadRun(args.dir);
  let bad = 0;
  if (args.coverage !== undefined) {
    const b = Number(args.coverage);
    const { data } = loadData(run);
    const seen = new Set();
    for (const f of readdirSync(resolve(run.dir, "out")).filter((f) => f.startsWith(`review-${b}-`) && f.endsWith(".json"))) {
      for (const e of JSON.parse(readFileSync(resolve(run.dir, "out", f), "utf8"))) seen.add(`${e.project} ${e.key}`);
    }
    const missing = data.filter((r) => r.batch === b && listed(r) && !seen.has(`${r.project} ${r.key}`));
    console.log(missing.length ? `batch ${b}: ${missing.length} items must be listed and aren't: ${missing.map((r) => r.n).join(", ")}` : `batch ${b}: every CHOOSE and NO CANDIDATE item is listed`);
    process.exit(missing.length ? 1 : 0);
  }
  const problems = await entryChecker(run);
  for (const file of args._) {
    let entries;
    try {
      entries = JSON.parse(readFileSync(inRun(run, file), "utf8"));
    } catch (e) {
      console.log(`${file}: not valid JSON — ${e.message}`);
      bad++;
      continue;
    }
    if (!Array.isArray(entries)) {
      console.log(`${file}: must be a JSON array`);
      bad++;
      continue;
    }
    let shown = 0;
    for (const e of entries) {
      for (const p of problems(e)) {
        if (p.level === "error") bad++;
        console.log(`${p.level.toUpperCase()} [${e?.project}] ${e?.key} (#${e?.n}): ${p.text}`);
        shown++;
      }
    }
    console.log(`${file}: ${entries.length} entries, ${shown} problem lines`);
  }
  process.exit(bad ? 1 : 0);
}
