// SPDX-License-Identifier: MIT
// The agentic review's shared parts (docs/dev/agentic-review.md): the run folder and its manifest,
// docgen's own code, and the check every step runs on the Spanish an entry would write — docgen's
// checks, vue-i18n's message compiler (the version the apps ship), and a spellchecker as a hint.
//
// A run folder holds everything one review writes: run.json (the manifest export.js writes),
// data.json, the batch and verify files, guide.md and terms.md, out/ (the agents' entries) and the
// decisions. Every script takes it as --dir (default: the current folder).

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseCompile } from "@intlify/message-compiler";
import nspell from "nspell";
import { buildContext, checkOne } from "../../server/src/checks.js";
import { Project } from "../../server/src/service.js";

export { allFindings, Project } from "../../server/src/service.js";
export { buildContext, checkOne } from "../../server/src/checks.js";
export { stem } from "../../server/src/terms.js";

/** This folder (the guide, the language rules, the term sheets) and docgen's checkout. */
export const TOOL = dirname(fileURLToPath(import.meta.url));
export const DOCGEN = resolve(TOOL, "../..");

/** `--name value` / `--name=value` flags; a repeated flag collects into an array; the rest are
 *  positional. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    let value = eq > 0 ? a.slice(eq + 1) : argv[i + 1];
    if (eq < 0) {
      if (value === undefined || value.startsWith("--")) value = true;
      else i++;
    }
    if (name in out) out[name] = [].concat(out[name], value);
    else out[name] = value;
  }
  return out;
}

/** The run folder's manifest: {lang, reviewer, projects: [{id, config}], port}. */
export function loadRun(dir = ".") {
  const abs = resolve(dir);
  const run = JSON.parse(readFileSync(resolve(abs, "run.json"), "utf8"));
  return { ...run, dir: abs, config: (id) => run.projects.find((p) => p.id === id)?.config };
}

/** A run's records (data.json), keyed "project key". */
export function loadData(run) {
  const data = JSON.parse(readFileSync(resolve(run.dir, "data.json"), "utf8"));
  return { data, byId: new Map(data.map((r) => [`${r.project} ${r.key}`, r])) };
}

/** Nested catalog JSON → a Map of dotted keys. */
export function flat(o, p = "", m = new Map()) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") flat(v, key, m);
    else m.set(key, v);
  }
  return m;
}

/** vue-i18n's compiler errors for a message ([] when it compiles). */
export function compileErrors(s) {
  const errs = [];
  try {
    baseCompile(s, { onError: (e) => errs.push(e.message), jit: true });
  } catch (e) {
    errs.push(e.message);
  }
  return errs;
}

/** A spellchecker for the language — `dictionary-<lang>` when installed, else none (no hints). */
export async function speller(lang) {
  try {
    const { default: dictionary } = await import(`dictionary-${lang}`);
    return nspell(dictionary);
  } catch {
    return null;
  }
}

const WORD = /[\p{L}]+/gu;
/** Words in `dst` the spellchecker doesn't know — a hint, never a verdict: it lacks many valid
 *  forms and technical words (docgen's RESEARCH, 2026-10-17). */
export function spellHints(spell, dst, src, glossary) {
  if (!spell) return [];
  const enWords = new Set(src.toLowerCase().match(WORD) ?? []);
  const out = new Set();
  for (const w of dst.replace(/\{[^}]*\}/g, " ").match(WORD) ?? []) {
    if (w.length < 3 || /\p{Lu}.*\p{Lu}/u.test(w) || enWords.has(w.toLowerCase())) continue;
    if (glossary.some((g) => g.includes(w))) continue;
    if (!spell.correct(w) && !spell.correct(w.toLowerCase())) out.add(w);
  }
  return [...out];
}

// docgen codes that can be right to fire on a correct string (a word the language shares with
// English, a number written as a word, the language's own punctuation, a real repeated word): a
// warning the entry's reason must answer. Every other docgen code is an error.
export const WARN_CODES = new Set(["untranslated", "numbers", "endpunc", "doublewords"]);

/** The checker one run uses: problems(project, key, src, dst) → [{level, text}]. */
export async function checker(run) {
  const spell = await speller(run.lang);
  const ctxs = new Map();
  const ctxOf = (id) => {
    if (!ctxs.has(id)) {
      const p = new Project(run.config(id));
      ctxs.set(id, buildContext(p.cfg, p.conventions, run.lang));
    }
    return ctxs.get(id);
  };
  return (project, key, src, dst) => {
    const out = [];
    const ctx = ctxOf(project);
    for (const f of checkOne({ key, src, dst, ctx })) {
      out.push({ level: WARN_CODES.has(f.code) ? "warn" : "error", text: `docgen ${f.code}${f.detail ? `: ${f.detail}` : ""}` });
    }
    for (const m of compileErrors(dst)) out.push({ level: "error", text: `vue-i18n: ${m}` });
    const s = spellHints(spell, dst, src, (ctx.do_not_translate ?? []).map(String));
    if (s.length) out.push({ level: "hint", text: `spellchecker doesn't know: ${s.join(", ")}` });
    return out;
  };
}

/** A resolved path for an entries file: as given when it exists, else inside the run folder. */
export function inRun(run, file) {
  const p = resolve(file);
  return existsSync(p) ? p : resolve(run.dir, file);
}

/**
 * docgen's own server for one project, on a scratch data folder in the run (so the user's docgen
 * settings stay untouched and the reviewer it records is the run's), with JUST_AI_HOME there too
 * (so opening a project loads no model — docgen's RESEARCH). The project's machine state, which git
 * doesn't keep, is copied into the run's backup/ first. Returns {call(method, path, body), stop()}.
 */
export async function docgenServer(run, projectId) {
  const config = run.config(projectId);
  if (!config) throw new Error(`no project "${projectId}" in this run (${run.projects.map((p) => p.id).join(", ")})`);
  const state = resolve(dirname(config), ".just-ai-i18n-docgen-state.json");
  if (existsSync(state)) {
    mkdirSync(resolve(run.dir, "backup", projectId), { recursive: true });
    copyFileSync(state, resolve(run.dir, "backup", projectId, `state-${Date.now()}.json`));
  }
  const scratch = resolve(run.dir, "dg-scratch");
  mkdirSync(resolve(scratch, "data"), { recursive: true });
  mkdirSync(resolve(scratch, "ai-home"), { recursive: true });
  const base = `http://127.0.0.1:${run.port}`;
  const server = spawn(process.execPath, ["scripts/node24.js", "server/src/serve.js", "serve", "--port", String(run.port), "--data-dir", resolve(scratch, "data"), "--config", config], {
    cwd: DOCGEN,
    env: { ...process.env, JUST_AI_HOME: resolve(scratch, "ai-home") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (b) => { log += b; });
  server.stderr.on("data", (b) => { log += b; });
  const stop = () => {
    try {
      // the tree: node24.js starts Electron as Node, which starts the server
      if (process.platform === "win32") execFileSync("taskkill", ["/T", "/F", "/PID", String(server.pid)], { stdio: "ignore" });
      else server.kill();
    } catch {
      server.kill();
    }
  };
  process.on("exit", stop);
  const call = async (method, path, body) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
    return JSON.parse(text);
  };
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/v1/health`)).ok) break;
    } catch {}
    if (i > 120) {
      stop();
      throw new Error(`docgen's server did not come up on ${run.port}:\n${log.slice(-2000)}`);
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  const s = await call("GET", "/v1/summary");
  if (resolve(s.configPath).toLowerCase() !== resolve(config).toLowerCase()) {
    stop();
    throw new Error(`docgen loaded ${s.configPath}, not ${config}`);
  }
  if ((await call("GET", "/v1/reviewer")).reviewer !== run.reviewer) await call("PUT", "/v1/reviewer", { reviewer: run.reviewer });
  return { call, stop };
}
