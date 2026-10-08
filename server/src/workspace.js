// SPDX-License-Identifier: MIT
// The review Workspace — the port of workspace.py (ported from just-ai-help's
// `server/server.js`).
//
// WHAT WRITES WHAT — the rule the whole design rests on:
//
//     locale JSON       only ever written by an explicit human action in here
//     accepted.json     accept / unaccept
//     notes.json        the per-key note that feeds the next translation
//     .just-ai-i18n-docgen-state.json   this project: progress, undo, proposals, confirmations, runs
//     the shared DB     providers, presets, reviewer — machine state, never per-project
//
// A job never writes a locale file. Engine output is staged and applied by a person.
//
// Engine connections and settings.json are GONE — providers and presets live in the shared
// LLM stack, jobs resolve through the SAME engine seam the CLI uses (engine.makeSend), and
// the reviewer's name lives in the app's own table. The two-resolver bug cannot recur
// because there is exactly one resolver to call.
//
// The HTTP routes over this class live in `api/workspace_api.js` (+ setup_api /
// server_auth_api / health_api) — the family tree. This module keeps the domain: the
// Workspace holder, the write rules, and the prompt-preview builders.

import { HttpError } from "@delebash/llm-runner/platform/errors";
import { cmp, isDict, pyGet, pyIter, pyMax, truthy } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { buildConfirmPrompt } from "./confirm.js";
import { JobManager } from "./jobs.js";
import { flatten, placeholderRe, readJson, rebuild, writeText } from "./jsonio.js";
import { exists } from "./paths.js";
import { allFindings, Project } from "./service.js";
import { buildSystemPrompt, buildUserMessage, shield } from "./shieldlib.js";
import { dropConfirmation, dropProposal, dropReferences, proposalKeys, reviewStatuses } from "./state.js";

export const _UNLIMITED = 10 ** 9; // a UI scrolls; a CLI report has to truncate

/** One (optional) loaded project + the job manager + caches. A factory-style holder so tests
 * can point it at a temp directory. */
export class Workspace {
  constructor(configPath = null) {
    this.project = null;
    this.jobs = new JobManager();
    this.termCache = new Map();
    if (configPath) this.load(configPath);
  }

  load(configPath) {
    this.project = new Project(configPath);
    this.jobs = new JobManager({ store: this.project.state });
    this.termCache = new Map();
  }

  // ── file mutations ─────────────────────────────────────────────────────────

  /**
   * Writes one key back, rebuilding nesting from the SOURCE so the diff is one line.
   * `value === null` REMOVES the key — that case exists for undo: a key that had no
   * translation must go back to having none; writing "" instead turns a `missing` finding
   * into a `blank` one and ships an empty string.
   *
   * Also retires everything that was ABOUT the old text: the probe entry (a human edit will
   * almost always differ from the machine's second pass, and without this the reviewer's own
   * fix becomes the evidence against it), the cached second opinion, the staged proposal (a
   * proposal staged against the old string could be applied OVER the newer text, silently
   * reverting the reviewer's fix — a real bug), and the confirmation verdict.
   */
  writeKey(lang, key, value) {
    const p = this.project;
    const values = p.targetFlat(lang) ?? new Map();
    if (value === null || value === undefined) values.delete(key);
    else values.set(key, value);
    writeText(p.paths.targetFile(lang), `${pyJson(rebuild(p.sourceRaw, values), { indent: 2, ensureAscii: false })}\n`);
    const probe = p.paths.probeFile(lang);
    if (exists(probe)) {
      const pf = flatten(readJson(probe));
      if (pf.has(key)) {
        pf.delete(key);
        writeText(probe, `${pyJson(rebuild(p.sourceRaw, pf), { indent: 2, ensureAscii: false })}\n`);
      }
    }
    dropReferences(p.state, { lang, key });
    dropProposal(p.state, { lang, key });
    dropConfirmation(p.state, { lang, key });
  }

  writeNote(lang, key, note) {
    const p = this.project;
    const notes = flatten(p.readNotes(lang));
    if (note === null || note === undefined) notes.delete(key);
    else notes.set(key, note);
    const sorted = new Map([...notes].sort(([a], [b]) => cmp(a, b)));
    writeText(p.paths.notesFile(lang), `${pyJson(sorted, { indent: 2, ensureAscii: false })}\n`);
  }

  // ── the queue ──────────────────────────────────────────────────────────────

  /** [targetFlat, findings, accepted] for one language. */
  findingsFor(lang) {
    const p = this.project;
    const targetFlat = p.targetFlat(lang) ?? new Map();
    const [findings, accepted] = allFindings(p, lang, targetFlat, {
      topN: _UNLIMITED,
      includeTerms: true,
      termCache: this.termCache,
    });
    return [targetFlat, findings, accepted];
  }

  buildRows(lang = null) {
    const p = this.project;
    const wanted = truthy(lang) ? [lang] : pyIter(p.targets);
    const rows = [];
    const counts = {};
    let acceptedTotal = 0;
    const bump = (code) => {
      counts[code] = (Object.hasOwn(counts, code) ? counts[code] : 0) + 1;
    };

    for (const lg of wanted) {
      const [targetFlat, findings, accepted] = this.findingsFor(lg);
      acceptedTotal += accepted.length;
      const statuses = reviewStatuses(p.state, lg);
      const notes = flatten(p.readNotes(lg));
      const staged = proposalKeys(p.state, lg); // one query, not one per row
      const status = (key) => (Object.hasOwn(statuses, key) ? (statuses[key].status ?? null) : null);

      const byKey = new Map();
      for (const f of findings) {
        if (!byKey.has(f.key)) byKey.set(f.key, []);
        byKey.get(f.key).push({
          code: f.code,
          detail: f.detail,
          advisory: truthy(f.advisory),
          suggestion: f.suggestion ?? null,
          confirmed: f.confirmed ?? null,
          confirmedBy: f.confirmedBy ?? null,
        });
        bump(f.code);
      }

      for (const [key, flags] of byKey) {
        rows.push({
          lang: lg,
          key,
          source: p.src.get(key) ?? "",
          target: targetFlat.get(key) ?? "",
          flags,
          status: status(key),
          note: notes.get(key) ?? null,
          hasProposal: staged.has(key),
        });
      }
      // Keys with no translation at all are work too — the old page hid them.
      for (const [key, src] of p.src) {
        if (!targetFlat.has(key) && !byKey.has(key)) {
          rows.push({
            lang: lg,
            key,
            source: src,
            target: "",
            flags: [{ code: "missing", detail: "not translated", advisory: false }],
            status: status(key),
            note: notes.get(key) ?? null,
            hasProposal: false,
          });
          bump("missing");
        }
      }
    }

    rows.sort((a, b) => b.flags.length - a.flags.length || cmp(a.key, b.key) || cmp(a.lang, b.lang));
    return { rows, counts, accepted: acceptedTotal, langs: p.targets, total: rows.length };
  }
}

/**
 * The default sample language is the BUSIEST one (the agreed A922 default): most pending keys
 * for translate; for confirm most byte-identical, then most translated. Ties keep target order
 * (Python's max returns the first maximum).
 */
export function _pickPreviewLang(p, feature) {
  const targets = pyIter(p.targets);
  if (!targets.length) return "";

  const counts = (lg) => {
    const dst = p.targetFlat(lg) ?? new Map();
    let pending = 0;
    let identical = 0;
    let translated = 0;
    for (const [k, v] of p.src) {
      if (!dst.has(k)) pending += 1;
      if (dst.get(k) === v) identical += 1;
      const d = dst.get(k);
      if (typeof d === "string" && d) translated += 1;
    }
    return [pending, identical, translated];
  };

  if (feature === "confirm") return pyMax(targets, (lg) => [counts(lg)[1], counts(lg)[2]]);
  return pyMax(targets, (lg) => counts(lg)[0]);
}

/**
 * The REAL translate prompt over a small live sample — the same builders the batch loop uses
 * (`loop.translateLanguage`), shielding included, so the kit's promptless Lab shows exactly
 * what a production run sends. A FINISHED language still shows the Lab (ruling 2026-08-04:
 * "def show the full lab" — the prompt SHAPE is identical), sampling already-translated keys
 * and saying so; the loud 400s are for explicit keys that don't exist and a catalogue with no
 * keys at all.
 */
export function _previewTranslate(p, lang, keys, n = 6) {
  // The SAME cfg the real run builds (start_job): the per-language conventions line and the
  // reviewer notes ride the preview too, or the Lab shows a prompt production never sends
  // (audit 2026-08-05 — both were dropped here). The glossary goes through _glossaryList:
  // both shapes are legal everywhere.
  const conv = pyGet(p.conventions, lang);
  const cfg = {
    ...p.cfg,
    conventionsLine: pyGet(truthy(conv) ? conv : {}, "promptLine", ""),
    notes: flatten(p.readNotes(lang)),
  };
  const phRe = placeholderRe(cfg.placeholder);
  const terms = _glossaryList(cfg);
  const system = buildSystemPrompt({
    source: pyGet(cfg, "sourceLanguage", "en"),
    targetLang: lang,
    doNotTranslate: terms,
    conventionsLine: cfg.conventionsLine,
    pluralSeparator: pyGet(cfg, "pluralSeparator"),
  });
  const existing = p.targetFlat(lang) ?? new Map();
  let sampledDone = false;
  let pick;
  if (truthy(keys)) {
    pick = pyIter(keys)
      .filter((k) => p.src.has(k))
      .slice(0, n);
    if (!pick.length) throw new HttpError(400, "None of the requested keys exist in the source catalogue.");
  } else {
    pick = [...p.src.keys()].filter((k) => !existing.has(k)).slice(0, n);
    if (!pick.length) {
      pick = [...p.src.keys()].filter((k) => existing.has(k)).slice(0, n);
      sampledDone = true;
    }
    if (!pick.length) throw new HttpError(400, "The source catalogue has no keys to sample.");
  }
  const shielded = pick.map((k, i) => {
    const [sh] = shield(p.src.get(k), phRe, terms);
    return { key: k, text: p.src.get(k), i, shielded: sh };
  });
  const user = buildUserMessage(shielded, cfg);
  const label = sampledDone
    ? `every key translated — sampling ${shielded.length} done key(s)`
    : `${shielded.length} pending key(s)`;
  return { system, user, sample: `${label} · ${lang}` };
}

/**
 * The REAL confirm probe prompt: one key, exactly the shape `confirm.makeAsk` sends (one key
 * per call — never batched, by design). Prefers a byte-identical key (confirm's real prey); a
 * healthy project without one still shows the Lab (ruling 2026-08-04: "def show the full
 * lab") — the prompt SHAPE is identical over any key, and the sample line names which
 * fallback fed it. Explicit keys stay loud.
 */
export function _previewConfirm(p, lang, keys) {
  const dst = p.targetFlat(lang) ?? new Map();
  let picked;
  let note;
  if (truthy(keys)) {
    const same = pyIter(keys).filter((k) => p.src.has(k) && dst.get(k) === p.src.get(k));
    if (!same.length) throw new HttpError(400, `None of the requested keys are byte-identical in ${lang}.`);
    [picked, note] = [same[0], "identical key"];
  } else {
    const same = [...p.src.keys()].filter((k) => dst.get(k) === p.src.get(k));
    if (same.length) [picked, note] = [same[0], "identical key"];
    else {
      const translated = [...p.src.keys()].filter((k) => typeof dst.get(k) === "string" && dst.get(k));
      if (translated.length) [picked, note] = [translated[0], "no byte-identical targets right now — sampling"];
      else if (p.src.size) [picked, note] = [p.src.keys().next().value, "nothing translated yet — sampling"];
      else throw new HttpError(400, "The source catalogue has no keys to sample.");
    }
  }
  const cfg = p.cfg;
  const gl = pyGet(cfg, "glossary");
  const dnt = pyGet(truthy(gl) ? gl : {}, "doNotTranslate");
  const system = buildConfirmPrompt({
    targetLang: lang,
    context: pyGet(cfg, "context", ""),
    doNotTranslate: truthy(dnt) ? dnt : [],
  });
  const src = p.src.get(picked);
  const user = `Translate items: ${pyJson([{ id: 0, text: src }])}`;
  return { system, user, sample: `${note} ${picked} · ${lang}` };
}

/**
 * The glossary as a bare list whichever shape the config holds (the original's deliberate
 * both-shapes design; infer.js normalizes to the dict on load).
 */
export function _glossaryList(cfg) {
  const g = pyGet(cfg, "glossary");
  if (isDict(g)) {
    const d = pyGet(g, "doNotTranslate");
    return [...pyIter(truthy(d) ? d : [])];
  }
  return [...pyIter(truthy(g) ? g : [])];
}
