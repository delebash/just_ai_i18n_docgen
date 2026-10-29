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
// Workspace holder, the write rules, and the Lab's test input (labVariables).

import { HttpError } from "@delebash/core/platform/errors";
import { cmp, isDict, pyGet, pyIter, truthy } from "@delebash/core/platform/py";
import { pyJson } from "@delebash/core/platform/pyjson";
import { confirmVariables } from "./confirm.js";
import { flatten, placeholderRe, readJson, rebuild, writeText } from "./jsonio.js";
import { exists } from "./paths.js";
import { allFindings, Project, runCfg } from "./service.js";
import { backtranslateVariables, shield, translateVariables } from "./shieldlib.js";
import { recordSources } from "./sources.js";
import { dropConfirmation, dropProposal, dropReferences, proposalKeys, reviewStatuses } from "./state.js";

export const _UNLIMITED = 10 ** 9; // a UI scrolls; a CLI report has to truncate

/** One (optional) loaded project + caches. A factory-style holder so tests can point it at a
 * temp directory. Its translation runs are the app's jobs (app_state's JobRegistry, jobs.js). */
export class Workspace {
  constructor(configPath = null) {
    this.project = null;
    this.termCache = new Map();
    if (configPath) this.load(configPath);
  }

  load(configPath) {
    this.project = new Project(configPath);
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
   * reverting the reviewer's fix — a real bug), and the confirmation verdict. And it records
   * the English the new text was written for (sources.js) — a later change to that English is
   * then a finding.
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
    recordSources(p.paths.cachePath, lang, new Map([[key, value === null || value === undefined ? null : (p.src.get(key) ?? null)]]));
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
 * The Lab's test input for one action (the kit's FeatureLab, its language picker — boot/docgen.js): the {{variables}}
 * a real run of that action sends, over a small live sample of `lang`, from the same functions the runs call,
 * shielding included — so a Lab test sends what production sends. It replaced the read-only prompt preview
 * (2026-10-29), when the prompts became editable rows. A finished language still fills the Lab, sampling done keys
 * (ruling 2026-08-04: "def show the full lab"); the loud 400s are for a catalogue with nothing to sample.
 */
export function labVariables(p, action, lang, n = 6) {
  if (!pyIter(p.targets).includes(lang)) throw new HttpError(400, `unknown language: ${lang}`);
  const dst = p.targetFlat(lang) ?? new Map();
  const keys = [...p.src.keys()];
  if (!keys.length) throw new HttpError(400, "The source catalogue has no keys to sample.");
  if (action === "translate") {
    const cfg = runCfg(p, lang);
    const phRe = placeholderRe(cfg.placeholder);
    const terms = _glossaryList(cfg);
    // pending keys first; a finished language samples done ones
    let pick = keys.filter((k) => !dst.has(k)).slice(0, n);
    if (!pick.length) pick = keys.slice(0, n);
    const shielded = pick.map((key, i) => ({ key, i, shielded: shield(p.src.get(key), phRe, terms)[0] }));
    return translateVariables(shielded, cfg, lang, terms);
  }
  if (action === "confirm") {
    // a byte-identical key is the pass's real prey; any key shows the prompt's shape
    const key = keys.find((k) => dst.get(k) === p.src.get(k)) ?? keys[0];
    return confirmVariables({
      targetLang: lang,
      context: pyGet(p.cfg, "context", ""),
      doNotTranslate: _glossaryList(p.cfg),
      source: p.src.get(key),
    });
  }
  if (action === "review") {
    const key = keys.find((k) => typeof dst.get(k) === "string" && dst.get(k));
    if (key === undefined) throw new HttpError(400, `Nothing is translated into ${lang} yet — a back-translation reads a translation.`);
    return backtranslateVariables(dst.get(key), p.cfg, lang);
  }
  throw new HttpError(400, `No test input for "${action}".`);
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
