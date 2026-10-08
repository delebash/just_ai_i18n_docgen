// SPDX-License-Identifier: MIT
// The translate service — the flow that composes every ported layer. The port of service.py
// (ported from just-ai-help's `server/translate.js`, restructured from a CLI script into
// service functions BOTH doors call — the CLI (cli.js) and the review workspace API). The
// hard rule survives: one implementation of every decision, so a report and an escalation
// can never drift into flagging different things, and a config means the same thing
// whichever door you came through.
//
// The layers: TRANSLATE (loop.js — shield, send, restore, retry, never silently skip) ·
// VERIFY (checks.js + suspects.js — the differentiator: no translator makes assertions about
// its own output) · the confirmation pass (confirm.js — annotates, never signs off) ·
// acceptances (accepted.js — the human record, hash-expiring).
//
// The catalogues (`src`, a target, notes, a probe) are Maps — file order, as Python's dicts.
// Python's tests patch `service.make_send` and `service.require_probe_temperature`; those two
// are this module's own exports, called as `self.` (build sheet rule 18).

import { statSync } from "node:fs";
import path from "node:path";
import { purePath } from "@delebash/llm-runner/platform/data_paths";
import { FileNotFoundError, pySorted, ValueError } from "@delebash/llm-runner/platform/py";
import {
  acceptanceEntry,
  acceptanceHash,
  loadAccepted,
  partitionAccepted,
  saveAccepted,
  UNKNOWN_REVIEWER,
} from "./accepted.js";
import { buildContext, runChecks, summarise } from "./checks.js";
import * as confirm from "./confirm.js";
import { CONFIRM_CODE, attachConfirmations, confirmIdentical } from "./confirm.js";
import * as engine from "./engine.js";
import { inferConfig } from "./infer.js";
import {
  asMap,
  cpLen,
  dget,
  dumps,
  flatten,
  OSError,
  pyTruthy,
  readJson,
  rebuild,
  toPlain,
  writeText,
} from "./jsonio.js";
import { translateLanguage } from "./loop.js";
import { exists, projectPaths } from "./paths.js";
import * as self from "./service.js";
import { confirmations, dropConfirmation, openProject, putConfirmation, setReviewStatus } from "./state.js";
import { rankSuspects, spread } from "./suspects.js";
import { checkTerms } from "./terms.js";

export const PROBE_CACHE_FILE = ".just-ai-i18n-docgen-probe-cache.json";

/** The packaged conventions table (Python read it from the package's `config/`). */
function loadConventions() {
  return toPlain(readJson(path.join(import.meta.dirname, "config", "conventions.json")));
}

// ── the engine seams Python's tests patch on this module ─────────────────────
export const makeSend = (feature = "translate", presetId = null) => engine.makeSend(feature, presetId);
export const requireProbeTemperature = (feature = "translate") => engine.requireProbeTemperature(feature);

/**
 * One loaded project: config (inference applied and REPORTED), paths (anchored to the config
 * file), the source catalogue, conventions, and the workshop state.
 */
export class Project {
  constructor(configPath) {
    this.configPath = purePath(String(configPath));
    if (!exists(this.configPath)) throw new FileNotFoundError(`No config at ${configPath}`);
    const rawCfg = toPlain(readJson(this.configPath));
    this.paths = projectPaths(this.configPath, rawCfg);
    this.sourceRaw = readJson(this.paths.sourceFile);
    this.src = flatten(this.sourceRaw);
    [this.cfg, this.inferred] = inferConfig(rawCfg, this.src);
    // paths.sourceLanguage, not cfg: a `source`-shaped config carries the language in the
    // FILENAME — reading cfg printed "Translating undefined -> es" once.
    if (!Object.hasOwn(this.cfg, "sourceLanguage")) this.cfg.sourceLanguage = this.paths.sourceLanguage;
    this.conventions = loadConventions();
    this.state = openProject(this.paths.configDir);
    this._srcMtime = this._sourceMtime();
  }

  _sourceMtime() {
    try {
      return statSync(this.paths.sourceFile).mtimeMs;
    } catch {
      return null;
    }
  }

  /**
   * The source catalogue can change UNDER a running server — the CLI's `extract` writes
   * front-matter keys into en.json, and git/editors touch it too. The load-once cache then
   * reports findings about a file that no longer exists as read (audit 2026-08-05). One stat
   * per request at the workspace's route seam; a changed mtime re-reads. The term cache
   * self-invalidates — its stamp is computed from the content.
   */
  refreshSourceIfChanged() {
    const m = this._sourceMtime();
    if (m !== null && m !== this._srcMtime) {
      this.sourceRaw = readJson(this.paths.sourceFile);
      this.src = flatten(this.sourceRaw);
      this._srcMtime = m;
    }
  }

  get targets() {
    return dget(this.cfg, "targets", []);
  }

  /** Per-key notes written during review. Committed — a note changes translation output, so
   * it belongs with the run that produced it. Absent file = no notes. A Map. */
  readNotes(lang) {
    const p = this.paths.notesFile(lang);
    if (!exists(p)) return new Map();
    let raw;
    try {
      raw = readJson(p);
    } catch (e) {
      if (e instanceof ValueError || e instanceof OSError || e instanceof FileNotFoundError) return new Map();
      throw e;
    }
    return new Map([...flatten(raw)].filter(([k]) => !k.startsWith("_")));
  }

  /** The target catalogue, flattened (a Map), or null when the file isn't there. */
  targetFlat(lang) {
    const p = this.paths.targetFile(lang);
    if (!exists(p)) return null;
    return flatten(readJson(p));
  }
}

/**
 * EVERY finding for one language: the structural checks, the disagreement suspects when a
 * probe sidecar exists, optionally the terminology sweep, the confirmation annotations, and
 * the acceptance filter LAST — so an acceptance can clear a suspect as well as a check, and
 * escalation never re-spends engine time on a key a human already signed off.
 *
 * ONE function for the report, the escalate path and the workspace — they can never drift
 * into flagging different things. `topN=null` reads the config (the CLI report has to
 * truncate); the workspace passes a huge number because a UI scrolls — the last Node run
 * found 150 disagreements, showed 30, and both real defects ranked #22 and #30 OF THE THIRTY
 * SHOWN. `termCache` memoises the terminology index on the content it was computed from
 * (measured: the index is over half the cost of a request, and a request happens after every
 * accept and every edit). Returns [findings, accepted].
 */
export function allFindings(project, lang, targetFlat, { topN = null, includeTerms = false, termCache = null } = {}) {
  let findings = unfilteredFindings(project, lang, targetFlat, { topN, includeTerms, termCache });
  findings = attachConfirmations(findings, confirmations(project.state, lang), project.src, targetFlat);
  return partitionAccepted(findings, loadAccepted(project.paths.acceptedFile(lang)), project.src, targetFlat);
}

/**
 * Checks + disagreement suspects + (optionally) terminology — the findings BEFORE
 * confirmation attach and the acceptance filter. `/accept` records against THIS: the
 * filtered list makes a second accept a silent no-op, and a compose of runChecks alone
 * dropped advisory (terminology) and suspect findings from acceptance entirely (audit
 * 2026-08-05 — accepting a key whose one finding was terminology recorded nothing and the
 * flag survived the click).
 */
export function unfilteredFindings(project, lang, targetFlat, { topN = null, includeTerms = false, termCache = null } = {}) {
  let findings = runChecks({
    sourceFlat: project.src,
    targetFlat,
    ctx: buildContext(project.cfg, project.conventions, lang),
  });
  const probePath = project.paths.probeFile(lang);
  if (exists(probePath)) {
    const suspects = dget(project.cfg, "suspects");
    findings = findings.concat(
      rankSuspects({
        sourceFlat: project.src,
        targetFlat,
        probeFlat: flatten(readJson(probePath)),
        topN: topN !== null ? topN : dget(pyTruthy(suspects) ? suspects : {}, "topN", 20),
      }),
    );
  }
  if (includeTerms) findings = findings.concat(termFindings(project, lang, targetFlat, termCache));
  return findings;
}

/**
 * Terminology findings, memoised on a cheap content stamp — key counts plus the joined
 * values' length. A real hash of 2,039 strings would cost more than the 35 ms it is trying
 * to save. `cache` is a Map keyed by language.
 */
function termFindings(project, lang, targetFlat, cache) {
  const target = asMap(targetFlat);
  let total = 0;
  for (const v of target.values()) total += cpLen(v);
  const stamp = `${project.src.size}:${target.size}:${total}`;
  if (cache != null) {
    const hit = cache.get(lang);
    if (hit && hit.stamp === stamp) return hit.findings;
  }
  const found = checkTerms({ sourceFlat: project.src, targetFlat: target }).findings;
  if (cache != null) cache.set(lang, { stamp, findings: found });
  return found;
}

/** The project cfg as one language's run sends it: the conventions line and the notes. */
function runCfg(project, lang, notes) {
  const conv = dget(project.conventions, lang);
  return {
    ...project.cfg,
    conventionsLine: dget(pyTruthy(conv) ? conv : {}, "promptLine", ""),
    notes,
  };
}

/** `json.dumps(rebuild(...), indent=2, ensure_ascii=False) + "\n"` into `p`. */
function writeCatalogue(p, sourceRaw, values) {
  writeText(p, `${dumps(rebuild(sourceRaw, values), { indent: 2, ensureAscii: false })}\n`);
}

/**
 * Translates `subset` for one language and merges the result over what is already there.
 * `outPath`/`cachePath` are parameters because the probe pass runs this SAME function into a
 * sidecar with its OWN cache — sharing the main cache would poison every later delta (the
 * probe would overwrite the real translation's entries).
 */
export async function translateInto(project, lang, subset, send, { force = false, outPath = null, cachePath = null, log = console.log } = {}) {
  outPath = outPath || project.paths.targetFile(lang);
  cachePath = cachePath || project.paths.cachePath;
  const existing = exists(outPath) ? flatten(readJson(outPath)) : new Map();

  const write = (values) => {
    const merged = new Map(existing);
    for (const [k, v] of asMap(values)) merged.set(k, v);
    writeCatalogue(outPath, project.sourceRaw, merged);
    return merged;
  };

  const result = await translateLanguage({
    sourceFlat: subset,
    existingFlat: force ? new Map() : existing,
    lang,
    cfg: runCfg(project, lang, project.readNotes(lang)),
    cachePath,
    send,
    force,
    log,
    // Written after every batch so an interrupted hour-long run resumes instead of starting
    // over — the file is always complete-and-valid JSON, just with fewer keys.
    onBatch: write,
  });
  const merged = write(result.values);
  log(`${lang}: wrote ${result.values.size} keys in ${result.requests} request(s)`);
  if (result.failed.length) {
    log(
      `${lang}: ${result.failed.length} key(s) exhausted every retry: ` +
        result.failed.slice(0, 8).join(", ") +
        (result.failed.length > 8 ? " …" : ""),
    );
  }
  return { ...result, merged };
}

/**
 * The main flow: translate every target, optionally probe, then the confirmation pass.
 * Returns {hardFailures, langs: {lang: {failed, requests, probeMoved?}}}.
 */
export async function runTranslate(project, { send = null, ask = null, force = false, probe = false, noConfirm = false, log = console.log } = {}) {
  send = send || self.makeSend("translate");
  if (probe) {
    // Refuse rather than mislead, BEFORE any engine time is spent: at temperature 0 the two
    // probe passes are identical by construction. Guarded on the RESOLVED preset — the one
    // source the request body is built from (engine.js).
    self.requireProbeTemperature("translate");
  }

  let hardFailures = 0;
  const langs = {};
  for (const lang of project.targets) {
    const result = await translateInto(project, lang, project.src, send, { force, log });
    hardFailures += result.failed.length;
    langs[lang] = { failed: result.failed, requests: result.requests };

    if (probe) {
      // The SAME engine, a second time. force=true because the point is a fresh sample —
      // served from cache it would return the first answer and every key would agree with
      // itself. Its own cache file, never the main one.
      log(`${lang}: probe pass — same engine, second opinion`);
      const probed = await translateInto(project, lang, project.src, send, {
        force: true,
        outPath: project.paths.probeFile(lang),
        cachePath: path.join(project.paths.configDir, PROBE_CACHE_FILE),
        log,
      });
      const target = project.targetFlat(lang) ?? new Map();
      let moved = 0;
      for (const k of project.src.keys()) {
        const a = target.get(k);
        const b = probed.merged.get(k);
        if (typeof a === "string" && typeof b === "string" && spread(a, b) > 0) moved += 1;
      }
      langs[lang].probeMoved = moved;
      log(`${lang}: probe — ${moved}/${project.src.size} key(s) differed between the two passes`);
      if (moved === 0) {
        // A probe that finds nothing looks exactly like a catalogue with nothing wrong, and
        // those are very different states — the second is worth celebrating, the first means
        // the instrument is broken. This tool exists because a run that silently did nothing
        // looked like a run that worked.
        log(
          `${lang}: WARNING — the two passes agreed on EVERY key. That is ` +
            "implausible for a real catalogue; suspect the sampler, the cache or " +
            "the engine rather than reading this as a clean bill of health.",
        );
      }
    }
  }

  if (!noConfirm) await confirmationPass(project, { ask, log });
  return { hardFailures, langs };
}

/**
 * Runs only after a real translate, only over the LIVE identical findings — a key a human
 * signed off is never re-asked. BOTH outcomes are annotations in the state file; NEITHER is a
 * verdict: the engine never writes <lang>.accepted.json.
 */
async function confirmationPass(project, { ask = null, log = console.log } = {}) {
  ask = ask || confirm.makeAsk("confirm");
  for (const lang of project.targets) {
    const dst = project.targetFlat(lang);
    if (dst === null) continue;
    const [findings] = allFindings(project, lang, dst);
    const keys = findings.filter((f) => f.code === CONFIRM_CODE).map((f) => f.key);
    if (!keys.length) continue;
    log(`${lang}: confirming ${keys.length} identical key(s)`);
    const gl = dget(project.cfg, "glossary");
    const result = await confirmIdentical({
      keys,
      sourceFlat: project.src,
      targetFlat: dst,
      targetLang: lang,
      context: dget(project.cfg, "context", ""),
      doNotTranslate: dget(pyTruthy(gl) ? gl : {}, "doNotTranslate", []),
      ask,
    });
    const by = "engine (confirm preset)";
    for (const c of result.cleared) {
      putConfirmation(project.state, {
        lang,
        key: c.key,
        hash: acceptanceHash({ key: c.key, code: CONFIRM_CODE, src: c.src, dst: c.dst || "" }),
        verdict: "same",
        engine: by,
      });
    }
    for (const p of result.proposed) {
      putConfirmation(project.state, {
        lang,
        key: p.key,
        hash: acceptanceHash({ key: p.key, code: CONFIRM_CODE, src: p.src, dst: p.dst || "" }),
        verdict: "translate",
        suggestion: p.suggestion,
        engine: by,
      });
    }
    log(`  ${result.cleared.length} look correct as-is — approve them in the review page (nothing was signed off for you)`);
    if (result.proposed.length) {
      log(`  ${result.proposed.length} look SKIPPED. Suggestions, NOT applied:`);
      for (const p of result.proposed) log(`      ${p.key}  ${dumps(p.src)} -> ${dumps(p.suggestion)}`);
    }
    if (result.failed.length) log(`  ${result.failed.length} could not be checked (engine error) — left as findings`);
  }
}

/**
 * The post-checks — verify the FILES on disk, not the run that wrote them. Offline and
 * deterministic: what you run before you ship. `disagreement` is ADVISORY and does not fail
 * the result — a suspect says the model was unsure, not that it was wrong, and failing on
 * suspicion is exactly how a report gets ignored.
 */
export function runCheck(project, { log = console.log } = {}) {
  let failed = 0;
  const langs = {};
  for (const lang of project.targets) {
    const dst = project.targetFlat(lang);
    if (dst === null) {
      log(`FAIL ${lang}: no output file`);
      failed += 1;
      langs[lang] = { missingFile: true };
      continue;
    }
    const [findings, acceptedNow] = allFindings(project, lang, dst);
    let translated = 0;
    for (const k of project.src.keys()) if (pyTruthy(dst.get(k))) translated += 1;
    log(`\n${lang}: ${translated}/${project.src.size} translated`);
    for (const [code, items] of summarise(findings)) {
      if (code !== "disagreement") failed += items.length;
      const note = code === "disagreement" ? " [advisory — review or escalate]" : "";
      log(`  ${code} (${items.length})${note}: ${items.map((f) => f.key).join(", ")}`);
      for (const f of items) {
        if (pyTruthy(f.suggestion)) log(`      ${f.key}: suggested ${dumps(f.suggestion)} (not applied)`);
      }
    }
    if (!findings.length) log("  all checks passed");
    // ALWAYS printed, even at zero: an accepted finding is hidden from the exit code, never
    // from the reader.
    if (acceptedNow.length) log(`  ${acceptedNow.length} accepted as correct (in ${lang}.accepted.json), not counted`);
    langs[lang] = { findings, accepted: acceptedNow.length, translated };
  }
  return { failed, langs };
}

/**
 * Check what is on disk, re-translate ONLY what was flagged — checks AND suspects,
 * "everything flagged plus the top N" — with a different preset, then re-check and report
 * before/after. The cheap engine's work stays; the expensive one is spent only on the keys
 * that earned it.
 */
export async function runEscalate(project, presetId, { log = console.log } = {}) {
  const send = self.makeSend("translate", presetId);
  const out = {};
  for (const lang of project.targets) {
    const target = project.targetFlat(lang);
    if (target === null) {
      log(`${lang}: nothing to escalate — no ${lang}.json yet. Translate first.`);
      out[lang] = { missingFile: true };
      continue;
    }
    const [before, beforeOk] = allFindings(project, lang, target);
    const keys = pySorted(new Set(before.map((f) => f.key)));
    log(
      `${lang}: ${before.length} finding(s) across ${keys.length} key(s) before` +
        (beforeOk.length ? ` (${beforeOk.length} accepted, not escalated)` : ""),
    );
    if (!keys.length) {
      out[lang] = { before: 0, after: 0 };
      continue;
    }

    const subset = new Map(keys.filter((k) => project.src.has(k)).map((k) => [k, project.src.get(k)]));
    const result = await translateInto(project, lang, subset, send, { force: true, log });

    // Retire the probe entries for the keys just escalated: a disagreement means "THIS engine
    // was unsure here"; once a DIFFERENT engine has redone the key, the old second opinion
    // measures nothing — keeping it would flag the key forever.
    const probePath = project.paths.probeFile(lang);
    if (exists(probePath)) {
      const probeFlat = flatten(readJson(probePath));
      for (const k of keys) probeFlat.delete(k);
      writeCatalogue(probePath, project.sourceRaw, probeFlat);
    }

    const [after] = allFindings(project, lang, result.merged);
    log(`${lang}: ${before.length} -> ${after.length} finding(s), ${keys.length} -> ${new Set(after.map((f) => f.key)).size} key(s)`);
    out[lang] = { before: before.length, after: after.length, failed: result.failed };
  }
  return out;
}

/**
 * Records the CURRENT findings for these keys as reviewed-and-correct. No engine call — a
 * check-time verdict. The checks run WITHOUT the acceptance filter, because accepting is
 * about what they currently say and filtering first would make a second accept on the same
 * key a silent no-op.
 */
export function acceptKeys(project, keys, { by = "", log = console.log } = {}) {
  const reviewer = by || UNKNOWN_REVIEWER;
  let recorded = 0;
  for (const lang of project.targets) {
    const dst = project.targetFlat(lang);
    if (dst === null) {
      log(`${lang}: nothing to accept — no ${lang}.json yet.`);
      continue;
    }
    const p = project.paths.acceptedFile(lang);
    const store = loadAccepted(p);
    // The SAME composition the workspace door records against — advisory (terminology) and
    // suspect findings included (two doors, one meaning; audit 2026-08-05: this door
    // consulted runChecks alone).
    const raw = unfilteredFindings(project, lang, dst, { includeTerms: true });
    for (const key of keys) {
      const forKey = raw.filter((f) => f.key === key);
      if (!forKey.length) {
        log(`${lang}: ${key} — no current findings, nothing to accept`);
        continue;
      }
      for (const f of forKey) {
        const entry = acceptanceEntry({
          key,
          code: f.code,
          src: project.src.get(key) ?? "",
          dst: dst.get(key) ?? "",
          by: reviewer,
        });
        store[acceptanceHash({ key, code: f.code, src: entry.src, dst: entry.dst })] = entry;
        log(`${lang}: accepted ${f.code} on ${key}`);
        recorded += 1;
      }
      // A machine's opinion has served its purpose once a human has ruled — the workspace
      // door already did both of these; this door left stale pre-ticks behind (audit
      // 2026-08-05).
      setReviewStatus(project.state, { lang, key, status: "reviewed" });
      dropConfirmation(project.state, { lang, key });
    }
    saveAccepted(p, store);
  }
  log(`\n${recorded} finding(s) recorded as reviewed by "${reviewer}".`);
  if (reviewer === UNKNOWN_REVIEWER) {
    // Loud rather than silent: an acceptance claims a human looked, and when nobody said who,
    // the file says so and the person running it knows it will.
    log('\nWARNING: recorded as "unknown" — nobody claimed these verdicts. Pass --by <name> so the sidecar records who signed them off.');
  }
  return { recorded, reviewer };
}
