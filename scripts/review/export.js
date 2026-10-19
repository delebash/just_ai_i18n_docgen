// SPDX-License-Identifier: MIT
// Step 1 of the agentic review (docs/dev/agentic-review.md): exports one language of one or more
// docgen projects for the review agents. Reads only.
//
//   node scripts/review/export.js --dir <run> --lang es --project <id>=<config.json> [--project …]
//                                 [--batch-size 800] [--new] [--keys a.b,c.d] [--reviewer "<name>"] [--port 8743]
//
// For every key: its English, its candidates (A = docgen's staged proposal, B = the language's
// file now), docgen's own checks and the spellchecker's hints on each, and the English at staging
// time when it has changed since. `--new` takes only the keys with no translation and no proposal
// (a catalog's new strings since the last run); `--keys` adds the keys named — strings whose English
// changed after they were translated, which `--new` can't see (2026-10-18), each with its present
// translation to review against the new English. Writes, into the run folder:
//   run.json        the manifest every later step reads
//   data.json       every record (for the scripts)
//   batch-N.md      the reviewers' input, about --batch-size strings each, in key order
//   terms-input.md  how each recurring English term is rendered now (for the term-sheet agent)
//   guide.md        the method (guide.md here) + the language's rules (lang/<lang>.md) + each
//                   project's own context sentence (its config's `context`)
//   terms.md        the language's term sheet so far (terms/<lang>.md here), when there is one

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { buildContext, checkOne, flat, parseArgs, Project, speller, spellHints, stem, TOOL } from "./run.js";

const args = parseArgs();
const dir = resolve(args.dir || ".");
const lang = args.lang;
const specs = [].concat(args.project || []);
if (!lang || !specs.length) throw new Error("usage: export.js --dir <run> --lang <code> --project <id>=<config.json> [--project …]");
const projects = specs.map((s) => {
  const [id, config] = String(s).split("=");
  if (!id || !config) throw new Error(`--project ${s}: expected <id>=<config.json>`);
  return { id, config: resolve(config) };
});
const batchSize = Number(args["batch-size"] || 800);
const onlyNew = !!args.new;
const alsoKeys = new Set(String(args.keys || "").split(",").map((k) => k.trim()).filter(Boolean));
const today = new Date().toISOString().slice(0, 10);
const run = {
  lang,
  reviewer: args.reviewer || `Claude (AI review, ${today})`,
  port: Number(args.port || 8743),
  onlyNew,
  projects,
  exportedAt: new Date().toISOString(),
};
mkdirSync(resolve(dir, "out"), { recursive: true });

const spell = await speller(lang);
const git = (cwd, gitArgs) => execFileSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8", maxBuffer: 64 << 20 });

/** The English as committed at each moment a proposal was staged — following renames. */
function englishAt(repo, enRel, moments) {
  const lines = git(repo, ["log", "--follow", "--format=@%H %cI", "--name-only", "--", enRel]).split("\n");
  // Each commit is "@<hash> <date>", a blank line, then the file's path in that commit.
  const log = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("@")) continue;
    const [h, d] = lines[i].slice(1).split(" ");
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const p = j < lines.length && !lines[j].startsWith("@") ? lines[j].trim() : enRel;
    log.push({ h, t: Date.parse(d), p });
  }
  const cache = new Map();
  const at = new Map();
  for (const m of moments) {
    const c = log.find((x) => x.t <= Date.parse(m));
    if (!c) continue;
    if (!cache.has(c.h)) cache.set(c.h, flat(JSON.parse(git(repo, ["show", `${c.h}:${c.p}`]))));
    at.set(m, cache.get(c.h));
  }
  return at;
}

const records = [];
const contexts = [];
for (const pr of projects) {
  const p = new Project(pr.config);
  const ctx = buildContext(p.cfg, p.conventions, lang);
  const glossary = (ctx.do_not_translate ?? []).map(String);
  const current = p.targetFlat(lang) ?? new Map();
  const stateFile = resolve(dirname(pr.config), ".just-ai-i18n-docgen-state.json");
  const props = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")).proposals?.[lang] ?? {}) : {};
  const repo = git(dirname(pr.config), ["rev-parse", "--show-toplevel"]).trim();
  const enRel = relative(repo, p.paths.sourceFile).replaceAll("\\", "/");
  const moments = [...new Set(Object.values(props).map((r) => r.translate?.at).filter(Boolean))];
  const enThen = englishAt(repo, enRel, moments);
  contexts.push({ id: pr.id, context: p.cfg.context || "" });
  for (const [key, en] of p.src) {
    if (typeof en !== "string" || en === "") continue;
    const proposal = props[key]?.translate?.value ?? null;
    const cur = current.get(key);
    const file = typeof cur === "string" && cur !== "" ? cur : null;
    if (onlyNew && (proposal !== null || file !== null) && !alsoKeys.has(key)) continue;
    const cands = {};
    if (proposal !== null) cands.A = proposal;
    if (file !== null && file !== proposal) cands.B = file;
    const flags = {};
    const spellFlags = {};
    for (const [id, v] of Object.entries(cands)) {
      const f = checkOne({ key, src: en, dst: v, ctx }).map((x) => `${x.code}${x.detail ? `: ${x.detail}` : ""}`);
      if (f.length) flags[id] = f;
      const s = spellHints(spell, v, en, glossary);
      if (s.length) spellFlags[id] = s;
    }
    const then = proposal !== null ? enThen.get(props[key].translate.at)?.get(key) : undefined;
    const need = !cands.A && !cands.B ? "translate" : cands.A && cands.B ? "choose" : "review";
    records.push({ project: pr.id, key, en, cands, flags, spell: spellFlags, enAtStaging: then !== undefined && then !== en ? then : null, need });
  }
}

// ── batches of about batchSize strings, in project and key order ──
const nBatches = Math.max(1, Math.round(records.length / batchSize));
const batches = Array.from({ length: nBatches }, (_, i) =>
  records.slice(Math.round((i * records.length) / nBatches), Math.round(((i + 1) * records.length) / nBatches)),
);
batches.forEach((rs, bi) => {
  const lines = [];
  rs.forEach((r, i) => {
    r.batch = bi + 1;
    r.n = i + 1;
    lines.push(`## ${i + 1}. [${r.project}] ${r.key}${r.need === "choose" ? "  — CHOOSE A or B (or fix)" : r.need === "translate" ? "  — NO CANDIDATE: write the translation" : ""}`);
    lines.push(`EN: ${JSON.stringify(r.en)}`);
    if (r.enAtStaging !== null) lines.push(`EN when A was made (changed since): ${JSON.stringify(r.enAtStaging)}`);
    if (r.cands.A !== undefined) lines.push(`A (docgen's proposal): ${JSON.stringify(r.cands.A)}`);
    if (r.cands.B !== undefined) lines.push(`B (in the file now): ${JSON.stringify(r.cands.B)}`);
    for (const id of ["A", "B"]) {
      if (r.flags[id]) lines.push(`docgen checks on ${id}: ${r.flags[id].join(" · ")}`);
      if (r.spell[id]) lines.push(`spellchecker doesn't know (${id}): ${r.spell[id].join(", ")}`);
    }
    lines.push("");
  });
  writeFileSync(resolve(dir, `batch-${bi + 1}.md`), `# Batch ${bi + 1} — ${rs.length} strings\n\n${lines.join("\n")}`);
});
run.batches = batches.map((b) => b.length);
writeFileSync(resolve(dir, "data.json"), JSON.stringify(records, null, 1));
writeFileSync(resolve(dir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);

// ── the guide, assembled; the term sheet so far ──
const langRules = resolve(TOOL, "lang", `${lang}.md`);
if (!existsSync(langRules)) throw new Error(`no language rules for "${lang}": write ${langRules} first (lang/es.md is the model)`);
const catalogs = contexts.map((c) => `- **${c.id}** — ${c.context || "(its config has no context sentence)"}`).join("\n");
writeFileSync(
  resolve(dir, "guide.md"),
  `${readFileSync(resolve(TOOL, "guide.md"), "utf8").trimEnd()}\n\n## The catalogs in this run\n\nEach project's own context sentence (its docgen config):\n\n${catalogs}\n\n${readFileSync(langRules, "utf8").trimEnd()}\n`,
);
const sheet = resolve(TOOL, "terms", `${lang}.md`);
if (existsSync(sheet)) copyFileSync(sheet, resolve(dir, "terms.md"));

// ── the term-sheet agent's input: how each recurring English term is rendered now ──
// Function words say nothing about terminology; these lists only thin the input, never decide.
const EN_STOP = new Set(
  "the a an and or but if then than this that these those there here your you yours our we it its is are was were be been being has have had do does did done can could will would should may might must not no yes all any each every some more most less few many much other another such only own same so too very just also into onto from with without within for about above below over under after before again once when where why how what which who whom whose while until both either neither per via out off up down on in at by to of as one two new now still yet already even ever never always".split(" "),
);
const STOP = {
  es: new Set(
    "el la los las un una unos unas y o u pero si sino que de del al a en con sin por para sobre entre desde hasta hacia según este esta estos estas ese esa esos esas aquel su sus tu tus mi mis nuestro nuestra lo le les se es son está están ser fue era ha han hay no ni ya muy más menos cada todo toda todos todas otro otra otros otras mismo misma cual cuál cuando cuándo donde dónde como cómo qué quién también solo sólo aún antes después ahora siempre nunca puede pueden".split(" "),
  ),
};
function concordance(rs, n) {
  const stop = STOP[lang] ?? new Set();
  const words = (s, sw) => (s.replace(/\{[^}]*\}/g, " ").toLowerCase().match(/[\p{L}]+/gu) ?? []).filter((w) => w.length >= 3 && !sw.has(w));
  const byTerm = new Map();
  const add = (t, r) => {
    if (!byTerm.has(t)) byTerm.set(t, new Set());
    byTerm.get(t).add(r);
  };
  const global = new Map();
  for (const r of rs) {
    const tr = r.cands.A ?? r.cands.B;
    if (!tr) continue;
    for (const w of new Set(words(tr, stop))) global.set(stem(w), (global.get(stem(w)) ?? 0) + 1);
    const ws = r.en.replace(/\{[^}]*\}/g, " ").toLowerCase().match(/[\p{L}]+/gu) ?? [];
    for (const w of ws) if (w.length >= 3 && !EN_STOP.has(w)) add(w, r);
    for (let i = 0; i + 1 < ws.length; i++) {
      if (!EN_STOP.has(ws[i]) && !EN_STOP.has(ws[i + 1]) && ws[i].length >= 3 && ws[i + 1].length >= 3) add(`${ws[i]} ${ws[i + 1]}`, r);
    }
  }
  const rows = [];
  for (const [t, set] of byTerm) {
    const list = [...set].filter((r) => r.cands.A ?? r.cands.B);
    if (list.length < n) continue;
    const counts = new Map();
    const forms = new Map();
    for (const r of list) {
      for (const w of new Set(words(r.cands.A ?? r.cands.B, stop))) {
        const s = stem(w);
        counts.set(s, (counts.get(s) ?? 0) + 1);
        if (!forms.has(s)) forms.set(s, new Map());
        forms.get(s).set(w, (forms.get(s).get(w) ?? 0) + 1);
      }
    }
    // Rank the translations by how much more often they show up with this term than overall.
    const ranked = [...counts].map(([s, c]) => [s, c, c / Math.sqrt(global.get(s) ?? 1)]).sort((a, b) => b[2] - a[2]).slice(0, 4);
    if (!ranked.length) continue;
    const top = ranked.map(([s, c]) => `${[...forms.get(s)].sort((a, b) => b[1] - a[1])[0][0]} ${c}`);
    rows.push({ t, n: list.length, projects: [...new Set(list.map((r) => r.project))].join("+"), top, split: ranked[0][1] / list.length < 0.85 });
  }
  return rows.sort((a, b) => b.n - a.n);
}
const conc = concordance(records, 3);
writeFileSync(
  resolve(dir, "terms-input.md"),
  `# How each recurring English term is rendered now (${conc.length} terms in 3+ strings)\n\n` +
    "Format: English term (strings, catalogs) → the commonest words in those strings' translations, with counts.\n" +
    "The translation used is docgen's proposal, or the file's where there is none.\n\n" +
    conc.map((r) => `- ${r.split ? "SPLIT " : ""}${r.t} (${r.n}, ${r.projects}) → ${r.top.join(" · ")}`).join("\n") +
    "\n",
);

const count = (f) => records.filter(f).length;
console.log(
  JSON.stringify({
    dir,
    total: records.length,
    perProject: Object.fromEntries(projects.map((p) => [p.id, count((r) => r.project === p.id)])),
    need: { review: count((r) => r.need === "review"), choose: count((r) => r.need === "choose"), translate: count((r) => r.need === "translate") },
    withDocgenFlags: count((r) => Object.keys(r.flags).length),
    withSpellHints: count((r) => Object.keys(r.spell).length),
    englishChangedSinceStaging: count((r) => r.enAtStaging !== null),
    batches: run.batches,
    terms: conc.length,
    termSheet: existsSync(sheet) ? "copied" : "none yet",
  }),
);
