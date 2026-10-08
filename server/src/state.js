// SPDX-License-Identifier: MIT
// Project state — everything the tool remembers about ONE app, in one JSON file. The port of
// state.py (ported from just-ai-help's `server/state.js`, reasoning intact).
//
// WHAT IS AND IS NOT IN HERE. `.just-ai-i18n-docgen-state.json` is gitignored and holds only
// what a re-run can rebuild: the review cursor, the undo log, staged proposals, confirmation
// verdicts, cached second opinions, run history. Delete it and you lose your place in a
// review, never your work. The committed human record (`config.json`,
// `<lang>.accepted.json`, `<lang>.notes.json`) lives in the TRANSLATED app's repo. Machine
// state (providers, keys, presets) lives in the shared LLM stack's DB. This file is the third
// thing: per-project workshop state.
//
// CONCURRENCY. A CLI run and an open review page can both write. Every mutation RE-READS the
// file, applies its change and writes atomically (temp file + rename), so the window for a
// lost update is one mutation rather than one process lifetime. It is not a lock, and this
// header says so rather than implying safety that is not here.
//
// The data is plain JavaScript (Python's dicts read back for lookups); a locale key that is a
// small integer ("404") is written in JS's key order — the file is machine-only.

import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { FileNotFoundError, pySorted, ValueError } from "@delebash/llm-runner/platform/py";
import { dumps, OSError, pyTruthy, readJson, toPlain, writeText } from "./jsonio.js";
import { exists } from "./paths.js";

export const STATE_FILE = ".just-ai-i18n-docgen-state.json";
export const STATE_VERSION = 1;

// The mutations an undo has to be able to reverse. A `bulk-` kind is ONE action over many
// keys, so a batch stays one click and one undo (`prev` is a {key: value} map).
export const ACTION_KINDS = ["edit", "accept", "unaccept", "apply", "discard", "note", "bulk-accept", "bulk-apply", "bulk-discard"];

/** `datetime.now(tz=utc).isoformat()` — microseconds from the millisecond clock, omitted
 * when zero as Python's isoformat omits them. */
export function nowIso() {
  const iso = new Date().toISOString(); // 2026-10-08T12:34:56.789Z
  const ms = iso.slice(20, 23);
  return `${iso.slice(0, 19)}${ms === "000" ? "" : `.${ms}000`}+00:00`;
}

function empty() {
  return {
    version: STATE_VERSION,
    review: {},
    actions: [],
    nextActionId: 1,
    proposals: {},
    confirmations: {},
    references: {},
    runs: [],
    nextRunId: 1,
  };
}

/**
 * Temp file + rename — atomic on both Windows and POSIX, so a crash mid-write leaves the
 * previous file intact rather than a truncated one. Whole-file JSON writes without this are
 * how a cache gets corrupted, and a corrupted cache is what cost 27 minutes and 464
 * hand-corrected keys.
 */
export function writeJsonAtomic(p, value) {
  mkdirSync(path.dirname(String(p)), { recursive: true });
  const tmp = `${p}.tmp`;
  writeText(tmp, `${dumps(value, { indent: 2, ensureAscii: false })}\n`);
  try {
    renameSync(tmp, String(p));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** A JSON file, or `fallback` for missing OR corrupt. A corrupt file costs state, never
 * work. */
export function readJsonSafe(p, fallback) {
  if (!exists(p)) return fallback;
  try {
    return toPlain(readJson(p));
  } catch (e) {
    if (e instanceof ValueError || e instanceof OSError || e instanceof FileNotFoundError) return fallback;
    throw e;
  }
}

/**
 * A handle over one JSON file. `mutate` re-reads before applying, so a change made by the
 * other process between this handle's last read and now is not silently discarded.
 */
export class JsonStore {
  constructor(p, emptyFn = empty) {
    this.path = String(p);
    this.empty = emptyFn;
    this.data = orEmpty(readJsonSafe(this.path, null), this.empty);
  }

  read() {
    this.data = orEmpty(readJsonSafe(this.path, null), this.empty);
    return this.data;
  }

  mutate(fn) {
    const d = this.read();
    const out = fn(d);
    writeJsonAtomic(this.path, d);
    return out;
  }
}

// `read_json_safe(...) or empty()` — an empty dict/list or a falsy value starts fresh.
const orEmpty = (v, emptyFn) => (pyTruthy(v) ? v : emptyFn());

/** The state file for one project. `projectRoot` is the config's own folder. */
export function openProject(projectRoot) {
  return new JsonStore(path.join(String(projectRoot), STATE_FILE));
}

const setdefault = (obj, k, v) => {
  if (!Object.hasOwn(obj, k)) obj[k] = v;
  return obj[k];
};

// ── Review progress ──────────────────────────────────────────────────────────

/** 'reviewed' | 'skipped' | null, where null means "seen but undecided" — visiting a key must
 * not silently count as approving it. */
export function setReviewStatus(s, { lang, key, status }) {
  s.mutate((d) => {
    setdefault(d.review, lang, {})[key] = { status, visitedAt: nowIso() };
  });
}

export function reviewStatuses(s, lang) {
  const all = s.read().review[lang] ?? {};
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v.status !== null && v.status !== undefined));
}

export function reviewProgress(s, lang) {
  const out = { reviewed: 0, skipped: 0 };
  for (const v of Object.values(s.read().review[lang] ?? {})) {
    if (v.status === "reviewed" || v.status === "skipped") out[v.status] += 1;
  }
  return out;
}

// ── The action log ───────────────────────────────────────────────────────────

/**
 * Records one reversible mutation. `prev` is the whole point: it is what undo restores. A
 * caller passing nothing for it is recording something it cannot reverse — a bug in the
 * caller — so this raises rather than quietly logging an action that will fail when someone
 * presses undo six days later. (`prev: null` is a real value — "there was nothing"; leaving
 * it out is the error, as a missing required keyword is in Python.)
 */
export function recordAction(s, opts = {}) {
  if (!Object.hasOwn(opts, "prev")) {
    throw new TypeError("record_action() missing 1 required keyword-only argument: 'prev'");
  }
  const { lang, kind, prev, key = null, nextValue = null } = opts;
  if (!ACTION_KINDS.includes(kind)) throw new ValueError(`unknown action kind: ${kind}`);
  return s.mutate((d) => {
    const actionId = d.nextActionId;
    d.nextActionId += 1;
    d.actions.push({ id: actionId, lang, key, kind, prev, next: nextValue, at: nowIso(), undone: false });
    return actionId;
  });
}

export function lastAction(s, lang = null) {
  const acts = s.read().actions;
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i];
    if (a.undone) continue;
    if (pyTruthy(lang) && a.lang !== lang) continue;
    return a;
  }
  return null;
}

export function actionHistory(s, { lang = null, limit = 50 } = {}) {
  const acts = s.read().actions.filter((a) => !pyTruthy(lang) || a.lang === lang);
  return acts.slice(-limit).reverse(); // acts[-limit:] — a limit of 0 is everything, as Python
}

/**
 * Marks an action undone and returns it, so the caller can put `prev` back where it came
 * from. This module does NOT perform the reversal: undoing an edit writes a locale file and
 * undoing an accept rewrites the accepted file — both belong to the code that owns those
 * files. Keeping the log ignorant of them is what stops it becoming a second, competing
 * writer.
 */
export function popAction(s, { lang = null } = {}) {
  return s.mutate((d) => {
    for (let i = d.actions.length - 1; i >= 0; i--) {
      const a = d.actions[i];
      if (a.undone) continue;
      if (pyTruthy(lang) && a.lang !== lang) continue;
      a.undone = true;
      return a;
    }
    return null;
  });
}

// ── Proposals ────────────────────────────────────────────────────────────────

/**
 * Stages engine output. NOTHING here reaches a locale file until a human applies it — the
 * governing principle of the whole design; it is what makes a 50-minute bulk run safe to
 * cancel and a placeholder-mangling result harmless.
 */
export function putProposal(s, { lang, key, engine, value }) {
  s.mutate((d) => {
    setdefault(setdefault(d.proposals, lang, {}), key, {})[engine] = { value, at: nowIso() };
  });
}

export function proposals(s, { lang, key = null }) {
  const forLang = s.read().proposals[lang] ?? {};
  const keys =
    pyTruthy(key) && Object.hasOwn(forLang, key) ? [key] : key === null || key === undefined ? pySorted(Object.keys(forLang)) : [];
  const out = [];
  for (const k of keys) {
    for (const [engine, v] of Object.entries(forLang[k])) out.push({ lang, key: k, engine, value: v.value, at: v.at });
  }
  return pySorted(out, (r) => r.at, true);
}

export function proposalKeys(s, lang) {
  return new Set(Object.keys(s.read().proposals[lang] ?? {}));
}

export function proposalCount(s, lang) {
  return Object.keys(s.read().proposals[lang] ?? {}).length;
}

export function dropProposal(s, { lang, key, engine = null }) {
  s.mutate((d) => {
    const forKey = d.proposals[lang]?.[key];
    if (!pyTruthy(forKey)) return;
    if (pyTruthy(engine)) delete forKey[engine];
    else {
      delete d.proposals[lang][key];
      return;
    }
    if (!pyTruthy(forKey)) delete d.proposals[lang][key];
  });
}

export function dropAllProposals(s, lang) {
  return s.mutate((d) => {
    const n = Object.keys(d.proposals[lang] ?? {}).length;
    delete d.proposals[lang];
    return n;
  });
}

// ── Confirmation verdicts ────────────────────────────────────────────────────
// A verdict is workshop state, NOT a decision: it never turns a check green on its own. It
// pre-sorts the pile so a human can approve the obvious ones in one click. `hash` is over
// (key, code, src, dst) so a verdict expires the moment either string changes — the same rule
// an acceptance follows.

export function putConfirmation(s, { lang, key, hash, verdict, engine, suggestion = null }) {
  if (verdict !== "same" && verdict !== "translate") throw new ValueError(`unknown verdict: ${verdict}`);
  s.mutate((d) => {
    setdefault(d.confirmations, lang, {})[key] = { hash, verdict, suggestion, engine, at: nowIso() };
  });
}

/** Verdicts for a language, keyed by key. Callers check `hash` before trusting one. */
export function confirmations(s, lang) {
  return s.read().confirmations[lang] ?? {};
}

export function dropConfirmation(s, { lang, key }) {
  s.mutate((d) => {
    if (d.confirmations[lang]) delete d.confirmations[lang][key];
  });
}

// ── Reference cache ──────────────────────────────────────────────────────────

export function putReference(s, { lang, key, engine, value }) {
  s.mutate((d) => {
    setdefault(setdefault(d.references, lang, {}), key, {})[engine] = { value, at: nowIso() };
  });
}

export function getReference(s, { lang, key, engine }) {
  return s.read().references[lang]?.[key]?.[engine] ?? null;
}

/** Called when a key's translation changes, so stale advice cannot linger. */
export function dropReferences(s, { lang, key }) {
  s.mutate((d) => {
    if (d.references[lang]) delete d.references[lang][key];
  });
}

// ── Runs ─────────────────────────────────────────────────────────────────────
// "How did this catalogue get here" — two full catalogue runs in July 2026 were
// unreproducible because nothing recorded what produced them.

export function startRun(s, { lang, engine, scope }) {
  return s.mutate((d) => {
    const runId = d.nextRunId;
    d.nextRunId += 1;
    d.runs.push({
      id: runId,
      lang,
      engine,
      scope,
      keys: 0,
      requests: 0,
      elapsedMs: 0,
      failed: 0,
      startedAt: nowIso(),
      finishedAt: null,
    });
    return runId;
  });
}

export function finishRun(s, runId, { keys = 0, requests = 0, elapsedMs = 0, failed = 0 } = {}) {
  s.mutate((d) => {
    for (const r of d.runs) {
      if (r.id === runId) Object.assign(r, { keys, requests, elapsedMs, failed, finishedAt: nowIso() });
    }
  });
}

export function runHistory(s, { lang = null, limit = 20 } = {}) {
  const runs = s.read().runs.filter((r) => !pyTruthy(lang) || r.lang === lang);
  return runs.slice(-limit).reverse();
}
