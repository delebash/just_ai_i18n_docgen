// SPDX-License-Identifier: MIT
// The review workspace API — the project surface, jobs, and the GT frame. The port of
// api/workspace_api.py.
//
// Routes live at /v1 like every family route (/api was a Node-era habit, corrected
// 2026-08-02). The write rules the handlers obey (WHAT WRITES WHAT) are the Workspace class's
// contract — see workspace.js's header.
//
// The server starts WITHOUT a project — the setup screen (setup_api.js) has to be reachable
// before a config exists. Routes needing one get a 409 with `needsSetup` from one helper
// (`project()` below), not a change to every handler. Loading REPLACES the project wholesale;
// there is no swap-while-running path, because a half-swapped project with a job in flight is
// a bug waiting to be written.
//
// Python's tests patch `workspace_api.make_send`: it is this module's own export, called as
// `self.makeSend` (build sheet rule 18).

import { HttpError } from "@delebash/llm-runner/platform/errors";
import { T } from "@delebash/llm-runner/platform/models";
import { pySorted, RuntimeError, ValueError } from "@delebash/llm-runner/platform/py";
import * as appmeta from "../appmeta.js";
import { acceptanceEntry, acceptanceHash, loadAccepted, saveAccepted } from "../accepted.js";
import { getState } from "../app_state.js";
import { buildContext, checkOne } from "../checks.js";
import { CONFIRM_CODE, confirmIdentical, makeAsk } from "../confirm.js";
import * as engine from "../engine.js";
import { JobBusyError } from "../jobs.js";
import { dget, dumps, errText, firstOf, flatten, pyIter, pyStr, pyTruthy } from "../jsonio.js";
import { parseItems } from "../shieldlib.js";
import { unfilteredFindings } from "../service.js";
import {
  actionHistory,
  dropAllProposals,
  dropConfirmation,
  dropProposal,
  getReference,
  popAction,
  proposalCount,
  proposals,
  putConfirmation,
  putProposal,
  putReference,
  recordAction,
  reviewProgress,
  reviewStatuses,
  runHistory,
  setReviewStatus,
} from "../state.js";
import { checkKeyTerms, checkTerms, termUsage } from "../terms.js";
import { _glossaryList, _pickPreviewLang, _previewConfirm, _previewTranslate, _UNLIMITED } from "../workspace.js";
import * as self from "./workspace_api.js";
import { BODY } from "./server_auth_api.js";

// The only scopes a run may have. Anything else is a typo, and a typo must not start a job —
// found by driving the real catalogue: an unrecognised scope fell through to the flagged
// branch and started a 154-key run. `pending` is the dashboard's button: keys with no
// translation at all PLUS flagged ones — `flagged` alone selects nothing on a fresh language,
// because a key that is missing has no finding to flag.
export const SCOPES = new Set(["flagged", "unsure", "all", "keys", "pending"]);

/** The engine seam Python's tests patch on this module. */
export const makeSend = (feature = "translate", presetId = null) => engine.makeSend(feature, presetId);

const q = (props) => ({ querystring: T.Object(props) });
const optStr = () => T.Optional(T.String());

/** The loaded project, or the 409 that sends the UI to Setup. */
export function project() {
  const ws = getState().workspace;
  if (ws.project === null) throw new HttpError(409, { error: "no project loaded yet", needsSetup: true });
  // Every project route passes here — the one seam where an externally changed en.json (CLI
  // extract, git, an editor) gets picked up.
  ws.project.refreshSourceIfChanged();
  return ws.project;
}

/** `lang or p.targets[0]` */
const langOr = (lang, p) => (pyTruthy(lang) ? lang : firstOf(pyIter(p.targets)));

export async function router(app) {
  // ── the project surface ────────────────────────────────────────────────────

  app.get("/v1/state", async () => {
    const ws = getState().workspace;
    const p = project();
    const targets = pyIter(p.targets);
    return {
      langs: p.targets,
      source: dget(p.cfg, "sourceLanguage"),
      job: ws.jobs.status(),
      progress: Object.fromEntries(targets.map((lg) => [lg, reviewProgress(p.state, lg)])),
      proposals: Object.fromEntries(targets.map((lg) => [lg, proposalCount(p.state, lg)])),
    };
  });

  /**
   * The family contract for pipeline-owned prompts (app-structure.md): the kit's promptless
   * Lab POSTs {feature, lang?, keys?} and renders the REAL generated prompt read-only. Loud
   * named 400s; 409 needsSetup like every project route.
   */
  app.post("/v1/ai/prompt-preview", { schema: { body: BODY } }, async (req) => {
    const body = req.body;
    const p = project();
    const f = dget(body, "feature");
    const feature = pyStr(pyTruthy(f) ? f : "");
    const l = dget(body, "lang");
    const lang = pyStr(pyTruthy(l) ? l : "") || _pickPreviewLang(p, feature);
    if (!lang) throw new HttpError(400, "No target languages configured — add one in Setup.");
    const k = dget(body, "keys");
    const keys = pyTruthy(k) ? k : null;
    if (feature === "translate") return _previewTranslate(p, lang, keys);
    if (feature === "confirm") return _previewConfirm(p, lang, keys);
    throw new HttpError(400, `No prompt preview for "${feature}" yet — routing still picks its engine preset.`);
  });

  app.get("/v1/rows", { schema: q({ lang: optStr() }) }, async (req) => {
    project();
    return getState().workspace.buildRows(req.query.lang ?? null);
  });

  /**
   * The dashboard's one call: per-language done/total, findings, review state and the last
   * run — light enough to refresh after every job. Counts only; /rows is the page that
   * carries the strings.
   */
  app.get("/v1/summary", async () => {
    const ws = getState().workspace;
    const p = project();
    const langs = [];
    for (const lg of pyIter(p.targets)) {
      const targetFlat = p.targetFlat(lg) ?? new Map();
      const [, findings, accepted] = ws.findingsFor(lg);
      const statuses = reviewStatuses(p.state, lg);
      const translated = new Set();
      for (const k of p.src.keys()) {
        const v = targetFlat.get(k);
        if (typeof v === "string" && v !== "") translated.add(k);
      }
      // Findings are about TRANSLATED content — a key with no translation yet is backlog
      // (total - done), not a defect; counting it both ways made the header shout "36
      // findings" over rows saying "not yet translated".
      const flagged = new Set(findings.filter((f) => translated.has(f.key)).map((f) => f.key));
      const done = translated.size;
      let unreviewed = 0;
      for (const k of flagged) if ((Object.hasOwn(statuses, k) ? statuses[k].status : null) !== "reviewed") unreviewed += 1;
      const runs = runHistory(p.state, { lang: lg, limit: 1 });
      langs.push({
        code: lg,
        total: p.src.size,
        done,
        findings: flagged.size,
        unreviewed,
        accepted: accepted.length,
        staged: proposalCount(p.state, lg),
        lastRun: runs.length ? runs[0] : null,
      });
    }
    return {
      source: dget(p.cfg, "sourceLanguage"),
      keyCount: p.src.size,
      configPath: p.configPath,
      langs,
      job: ws.jobs.status(),
    };
  });

  app.get("/v1/accepted", { schema: q({ lang: optStr() }) }, async (req) => {
    const p = project();
    const lg = langOr(req.query.lang, p);
    const entries = loadAccepted(p.paths.acceptedFile(lg));
    return { lang: lg, entries: Object.entries(entries).map(([h, e]) => ({ hash: h, ...e })) };
  });

  app.post("/v1/save", { schema: { body: BODY } }, async (req) => {
    const body = req.body;
    const ws = getState().workspace;
    const p = project();
    const [lang, key, value] = [dget(body, "lang"), dget(body, "key"), dget(body, "value")];
    if (![lang, key, value].every((x) => typeof x === "string")) throw new HttpError(400, "lang, key and value must be strings");
    if (!p.src.has(key)) throw new HttpError(404, `no such key: ${key}`);
    const prev = (p.targetFlat(lang) ?? new Map()).get(key) ?? null;
    ws.writeKey(lang, key, value);
    recordAction(p.state, { lang, key, kind: "edit", prev, nextValue: value });
    setReviewStatus(p.state, { lang, key, status: "reviewed" });
    const flags = checkOne({ key, src: p.src.get(key), dst: value, ctx: buildContext(p.cfg, p.conventions, lang) }).map(
      (f) => ({ code: f.code, detail: f.detail }),
    );
    return { key, lang, flags };
  });

  /**
   * Records findings as reviewed-and-correct. BULK IS THE POINT: a fresh catalogue raises
   * ~70 `untranslated` findings that are almost all correct output, and seventy clicks is
   * what makes someone reach for a script — making the honest path cheap is what stops that.
   * ONE CALL IS ONE UNDO: the batch records a single bulk-accept holding every hash it added.
   * `by` comes from the app's reviewer setting — never the OS username.
   */
  app.post("/v1/accept", { schema: { body: BODY } }, async (req) => {
    const body = req.body;
    const ws = getState().workspace;
    const p = project();
    const lang = dget(body, "lang");
    const [key, keys] = [dget(body, "key"), dget(body, "keys")];
    const wanted = Array.isArray(keys) ? keys : key !== null ? [key] : null;
    if (typeof lang !== "string" || !pyTruthy(wanted) || !wanted.every((k) => typeof k === "string")) {
      throw new HttpError(400, "lang and keys[] (or key) must be strings");
    }
    const missing = wanted.filter((k) => !p.src.has(k));
    if (missing.length) throw new HttpError(404, `no such key: ${missing.join(", ")}`);

    const targetFlat = p.targetFlat(lang) ?? new Map();
    const wantedSet = new Set(wanted);
    // Re-run EVERY finding source WITHOUT the acceptance filter: accepting is about what the
    // page currently says, and filtering first makes a second accept a silent no-op.
    // unfilteredFindings carries the advisory (terminology) and suspect findings runChecks
    // alone dropped — accepting those recorded NOTHING and the flag survived (audit
    // 2026-08-05).
    const raw = unfilteredFindings(p, lang, targetFlat, {
      topN: _UNLIMITED,
      includeTerms: true,
      termCache: ws.termCache,
    }).filter((f) => wantedSet.has(f.key));
    const path = p.paths.acceptedFile(lang);
    const store = loadAccepted(path);
    const by = appmeta.getReviewer() || "";
    const added = [];
    for (const f of raw) {
      const entry = acceptanceEntry({
        key: f.key,
        code: f.code,
        src: p.src.get(f.key) ?? "",
        dst: targetFlat.get(f.key) ?? "",
        by,
      });
      const h = acceptanceHash({ key: f.key, code: f.code, src: entry.src, dst: entry.dst });
      if (!Object.hasOwn(store, h)) added.push(h);
      store[h] = entry;
    }
    saveAccepted(path, store);

    const bulk = wanted.length > 1;
    recordAction(p.state, {
      lang,
      key: bulk ? null : wanted[0],
      kind: bulk ? "bulk-accept" : "accept",
      prev: added,
      nextValue: bulk ? wanted : null,
    });
    for (const k of wanted) {
      setReviewStatus(p.state, { lang, key: k, status: "reviewed" });
      // A machine's opinion has served its purpose once a human has ruled.
      dropConfirmation(p.state, { lang, key: k });
    }
    return { lang, keys: wanted, recorded: added.length, by: by || null };
  });

  /**
   * The fix for the complaint that started the Node rebuild: an acceptance was one-way, and
   * accepted keys vanished from the page, so a decision could never be revisited.
   */
  app.delete("/v1/accept", { schema: { body: BODY } }, async (req) => {
    const body = req.body;
    const p = project();
    const [lang, key, code] = [dget(body, "lang"), dget(body, "key"), dget(body, "code")];
    if (typeof lang !== "string" || typeof key !== "string") throw new HttpError(400, "lang and key must be strings");
    const path = p.paths.acceptedFile(lang);
    const store = loadAccepted(path);
    const removed = {};
    for (const [h, e] of Object.entries(store)) {
      if (e.key === key && (code === null || e.code === code)) removed[h] = e;
    }
    for (const h of Object.keys(removed)) delete store[h];
    saveAccepted(path, store);
    recordAction(p.state, { lang, key, kind: "unaccept", prev: removed });
    return { key, lang, removed: Object.keys(removed).length };
  });

  app.post("/v1/undo", { schema: { body: BODY } }, async (req) => {
    const ws = getState().workspace;
    const p = project();
    const a = popAction(p.state, { lang: dget(req.body, "lang") });
    if (a === null) throw new HttpError(404, "nothing to undo");
    if (a.kind === "edit") {
      // null, not "" — a key that had no translation goes back to none.
      ws.writeKey(a.lang, a.key, a.prev);
    } else if (a.kind === "accept" || a.kind === "bulk-accept") {
      // Identical reversal for both: prev is the hashes THIS action added, so undoing a
      // 70-key approval is one step and never touches an acceptance that predates the click.
      const path = p.paths.acceptedFile(a.lang);
      const store = loadAccepted(path);
      for (const h of a.prev || []) delete store[h];
      saveAccepted(path, store);
    } else if (a.kind === "unaccept") {
      const path = p.paths.acceptedFile(a.lang);
      saveAccepted(path, { ...loadAccepted(path), ...(a.prev || {}) });
    } else if (a.kind === "note") {
      ws.writeNote(a.lang, a.key, a.prev);
    } else if (a.kind === "apply" || a.kind === "bulk-apply") {
      // Applying a proposal WRITES the locale file, so undo has to put the old text back —
      // exactly what `edit` does (until 2026-08-03 there was no branch here and undo answered
      // {"undone": …} having changed nothing on disk). `bulk-apply` carries a {key: prevValue}
      // map (one click, one undo); the legacy single `apply` carries one scalar prev, and old
      // state files still contain those, so both shapes are restored.
      if (a.kind === "bulk-apply") {
        for (const [key, prev] of Object.entries(a.prev || {})) ws.writeKey(a.lang, key, prev);
      } else ws.writeKey(a.lang, a.key, a.prev);
    } else if (a.kind === "bulk-discard") {
      // Re-stage what the discard dropped — proposals only, no locale write.
      for (const r of a.prev || []) {
        putProposal(p.state, { lang: a.lang, key: r.key, engine: r.engine || "engine", value: r.value });
      }
    }
    return { undone: a };
  });

  app.get("/v1/history", { schema: q({ lang: optStr() }) }, async (req) => ({
    actions: actionHistory(project().state, { lang: req.query.lang ?? null }),
  }));

  app.get("/v1/proposals", { schema: q({ lang: optStr(), key: optStr() }) }, async (req) => {
    const p = project();
    const lg = langOr(req.query.lang, p);
    return { lang: lg, proposals: proposals(p.state, { lang: lg, key: req.query.key ?? null }) };
  });

  app.post("/v1/proposals/apply", { schema: { body: BODY } }, async (req) => {
    const ws = getState().workspace;
    const p = project();
    const [lang, keys] = [dget(req.body, "lang"), dget(req.body, "keys")];
    if (typeof lang !== "string" || !Array.isArray(keys)) throw new HttpError(400, "lang and keys[] required");
    // ONE undo for the whole click — the bulk-accept promise, applied to writes. A run stages
    // one proposal per key, so "apply what the run produced" is a 2,000-key action; 2,000
    // undo entries would make the one thing you want after a bad run — put it back —
    // unreachable. `prev` is the map this action overwrote, and it is what undo restores.
    const current = p.targetFlat(lang) ?? new Map();
    const applied = [];
    const prevMap = {};
    for (const key of keys) {
      const rows = proposals(p.state, { lang, key });
      if (!rows.length) continue;
      prevMap[key] = current.get(key) ?? null;
      ws.writeKey(lang, key, rows[0].value);
      dropProposal(p.state, { lang, key });
      applied.push(key);
    }
    if (applied.length) {
      recordAction(p.state, { lang, kind: "bulk-apply", prev: prevMap, key: applied.length === 1 ? applied[0] : null });
    }
    return { lang, applied };
  });

  app.delete("/v1/proposals", { schema: { body: BODY } }, async (req) => {
    const p = project();
    const [lang, keys] = [dget(req.body, "lang"), dget(req.body, "keys")];
    if (typeof lang !== "string") throw new HttpError(400, "lang required");
    // Discard destroys staged work by hand, so it is UNDOABLE like every other human action
    // (audit 2026-08-05: it recorded nothing — the next undo silently reversed some OLDER
    // action instead). prev holds the dropped rows; undo re-stages them. The count is what
    // was actually dropped, never keys.length (a key with no proposal is not a discard).
    const wanted = keys === null ? null : new Set(pyIter(keys).filter((k) => typeof k === "string"));
    const dropped = proposals(p.state, { lang }).filter((r) => wanted === null || wanted.has(r.key));
    if (wanted === null) dropAllProposals(p.state, lang);
    else for (const key of wanted) dropProposal(p.state, { lang, key });
    if (dropped.length) {
      recordAction(p.state, {
        lang,
        kind: "bulk-discard",
        prev: dropped.map((r) => ({ key: r.key, value: r.value, engine: r.engine || "engine" })),
        key: dropped.length === 1 ? dropped[0].key : null,
      });
    }
    return { lang, discarded: dropped.length };
  });

  /**
   * How characterAudit.why was actually proven a defect: its sibling renders the same
   * label-with-colon pattern correctly. A reviewer needs that view.
   */
  app.get("/v1/siblings", { schema: q({ key: T.String(), lang: optStr() }) }, async (req) => {
    const { key } = req.query;
    const p = project();
    const lg = langOr(req.query.lang, p);
    const ns = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "";
    const targetFlat = p.targetFlat(lg) ?? new Map();
    // (A top-level key's namespace is "" — its "siblings" are keys starting with ".", as in
    // Python.)
    const sibs = [...p.src]
      .filter(([k]) => k !== key && k.startsWith(`${ns}.`) && !k.slice(ns.length + 1).includes("."))
      .slice(0, 25)
      .map(([k, src]) => ({ key: k, source: src, target: targetFlat.get(k) ?? "" }));
    return { key, namespace: ns, siblings: sibs };
  });

  app.get("/v1/terms", { schema: q({ lang: optStr(), key: optStr(), term: optStr() }) }, async (req) => {
    const { key = null, term = null } = req.query;
    const p = project();
    const lg = langOr(req.query.lang, p);
    const targetFlat = p.targetFlat(lg) ?? new Map();
    if (pyTruthy(term)) return { term, usage: termUsage({ sourceFlat: p.src, targetFlat, term }) };
    if (!pyTruthy(key)) throw new HttpError(400, "key or term required");
    const { index } = checkTerms({ sourceFlat: p.src, targetFlat });
    return {
      key,
      findings: checkKeyTerms({ key, src: p.src.get(key) ?? "", dst: targetFlat.get(key) ?? null, index }),
    };
  });

  app.put("/v1/notes", { schema: { body: BODY } }, async (req) => {
    const ws = getState().workspace;
    const p = project();
    const [lang, key] = [dget(req.body, "lang"), dget(req.body, "key")];
    const n = dget(req.body, "note");
    const note = pyTruthy(n) ? n : null;
    if (typeof lang !== "string" || typeof key !== "string") throw new HttpError(400, "lang and key required");
    const prev = flatten(p.readNotes(lang)).get(key) ?? null;
    ws.writeNote(lang, key, note);
    recordAction(p.state, { lang, key, kind: "note", prev, nextValue: note });
    return { lang, key, note };
  });

  app.get("/v1/runs", { schema: q({ lang: optStr() }) }, async (req) => ({
    runs: runHistory(project().state, { lang: req.query.lang ?? null }),
  }));

  app.get(
    "/v1/reference",
    { schema: q({ key: T.String(), lang: optStr(), engine: T.Optional(T.String({ default: "backtranslate" })) }) },
    async (req) => {
      const { key, engine: eng = "backtranslate" } = req.query;
      const p = project();
      const lg = langOr(req.query.lang, p);
      return { key, lang: lg, engine: eng, cached: getReference(p.state, { lang: lg, key, engine: eng }) };
    },
  );

  /**
   * The target string rendered BACK into the source language, through the "review" feature's
   * preset. It answers what no other layer can: "what does this actually say?" — the
   * difference between judging a translation and taking its word for it. It does NOT catch
   * everything (measured: a correct and an incorrect rendering back-translated to the SAME
   * English because the ambiguity was in the source). Read-only, cached, never written to a
   * catalogue.
   */
  app.post("/v1/backtranslate", { schema: { body: BODY } }, async (req) => {
    const p = project();
    const [lang, key] = [dget(req.body, "lang"), dget(req.body, "key")];
    if (typeof lang !== "string" || typeof key !== "string") throw new HttpError(400, "lang and key required");
    const dst = (p.targetFlat(lang) ?? new Map()).get(key);
    if (!dst) throw new HttpError(404, `no translation for ${key}`);
    const cached = getReference(p.state, { lang, key, engine: "backtranslate" });
    if (pyTruthy(cached)) return { key, lang, english: cached.value, cached: true };
    const sourceLang = dget(p.cfg, "sourceLanguage", "en");
    const system =
      `You are a translator, ${lang}→${sourceLang}. Translate the text ` +
      "literally, preserving any {placeholders} exactly. Output ONLY JSON " +
      "matching the schema.";
    let english;
    try {
      const send = self.makeSend("review");
      const out = await send(system, `Translate items: ${dumps([{ id: 0, text: dst }])}`);
      english = parseItems(out).get(0);
    } catch (e) {
      // A dead second opinion must never block reviewing. (EngineNotConfigured is a
      // RuntimeError; a reply that isn't JSON is a ValueError.)
      if (e instanceof RuntimeError || e instanceof ValueError) throw new HttpError(502, errText(e));
      throw e;
    }
    if (!english) throw new HttpError(502, "the engine returned nothing usable");
    putReference(p.state, { lang, key, engine: "backtranslate", value: english });
    return { key, lang, english, cached: false };
  });

  // ── jobs ───────────────────────────────────────────────────────────────────

  app.post("/v1/jobs", { schema: { body: BODY } }, async (req, reply) => {
    const body = req.body;
    const ws = getState().workspace;
    const p = project();
    const lang = dget(body, "lang");
    const scope = dget(body, "scope", "flagged");
    const keys = dget(body, "keys");
    const presetId = dget(body, "presetId");
    const targets = pyIter(p.targets);
    if (!targets.includes(lang)) throw new HttpError(400, `unknown language: ${pyStr(lang)}`);
    if (!SCOPES.has(scope)) {
      throw new HttpError(400, `unknown scope: ${pyStr(scope)}. Use one of ${pySorted(SCOPES).join(", ")}`);
    }
    if (ws.jobs.busy) throw new HttpError(409, "a job is already running");

    let wanted;
    if (scope === "keys") wanted = pyTruthy(keys) ? pyIter(keys) : [];
    else if (scope === "all") wanted = [...p.src.keys()];
    else {
      const [tflat, findings] = ws.findingsFor(lang);
      // The ruled semantics (2026-08-05, the original's intent): `flagged` = only
      // CHECKED-AND-FLAGGED keys — a finding on an EXISTING translation. A missing key was
      // never checked, so it belongs to `pending`, never `flagged` (same translated-only
      // filter /summary already applies).
      wanted = pySorted(
        new Set(findings.filter((f) => tflat.has(f.key) && (scope !== "unsure" || f.code === "disagreement")).map((f) => f.key)),
      );
      if (scope === "pending") {
        const pending = new Set(wanted);
        for (const k of p.src.keys()) {
          const v = tflat.get(k);
          if (!(typeof v === "string" && v !== "")) pending.add(k);
        }
        wanted = pySorted(pending);
      }
    }
    const subset = new Map();
    for (const k of wanted) if (p.src.has(k) && !subset.has(k)) subset.set(k, p.src.get(k));
    if (!subset.size) throw new HttpError(400, "that scope selected no keys");

    // THE two-resolver fix, structural now: the job resolves through the SAME seam the CLI
    // uses. presetId is the escalate-from-the-page door.
    let send;
    try {
      send = self.makeSend("translate", presetId);
    } catch (e) {
      if (e instanceof engine.EngineNotConfigured) throw new HttpError(400, errText(e));
      throw e;
    }
    const conv = dget(p.conventions, lang);
    const cfg = {
      ...p.cfg,
      conventionsLine: dget(pyTruthy(conv) ? conv : {}, "promptLine", ""),
      // notes MUST be here: the note a reviewer writes on a key is sent when they press
      // re-translate on that same key — the one place it matters.
      notes: flatten(p.readNotes(lang)),
    };

    // The confirmation pass for APP runs (the design's pre-tick, 2026-08-04 — only CLI
    // `translate` ran it before): called by the job worker with the DONE run's byte-identical
    // proposals; the hash carries the STAGED value, so the rows arrive pre-annotated the
    // moment they're applied. Annotations only — the engine never writes accepted.json.
    const confirmPass = async (identical, { isCancelled = null } = {}) => {
      // One key per call is the pass's own design ("a batch is how the original skip
      // happened") — looping here lets Cancel take effect between keys (the 2026-08-05
      // confirming-state fix).
      const ask = makeAsk("confirm");
      const by = "engine (confirm preset)";
      for (const key of pySorted([...identical.keys()])) {
        if (isCancelled?.()) return;
        const res = await confirmIdentical({
          keys: [key],
          sourceFlat: p.src,
          targetFlat: identical,
          targetLang: lang,
          context: dget(p.cfg, "context", ""),
          doNotTranslate: _glossaryList(p.cfg),
          ask,
        });
        for (const c of res.cleared) {
          putConfirmation(p.state, {
            lang,
            key: c.key,
            hash: acceptanceHash({ key: c.key, code: CONFIRM_CODE, src: c.src, dst: c.dst || "" }),
            verdict: "same",
            engine: by,
          });
        }
        for (const pr of res.proposed) {
          putConfirmation(p.state, {
            lang,
            key: pr.key,
            hash: acceptanceHash({ key: pr.key, code: CONFIRM_CODE, src: pr.src, dst: pr.dst || "" }),
            verdict: "translate",
            suggestion: pr.suggestion,
            engine: by,
          });
        }
      }
    };

    let status;
    try {
      status = ws.jobs.start({
        lang,
        engine: pyTruthy(presetId) ? presetId : "translate",
        send,
        scope,
        subset,
        cfg,
        cachePath: p.paths.cachePath,
        confirm: confirmPass,
      });
    } catch (e) {
      if (e instanceof JobBusyError) throw new HttpError(409, errText(e));
      throw e;
    }
    reply.code(202);
    return { job: status };
  });

  app.get("/v1/jobs/current", async () => {
    project();
    return { job: getState().workspace.jobs.status() };
  });

  app.post("/v1/jobs/cancel", async () => {
    project();
    return { job: getState().workspace.jobs.cancel() };
  });

  /**
   * Server-sent events for a running job. The subscription is a queue the manager's
   * plain-callback subscriber feeds — transport stays out of jobs.js. A 15 s keepalive while
   * idle; the stream ends after the `done` event (or when the client goes away).
   */
  app.get("/v1/jobs/stream", async (req, reply) => {
    const ws = getState().workspace;
    project();
    // Starlette's StreamingResponse: status 200, the media type with its charset, our
    // cache-control. Headers a hook already set on the reply (CORS) ride along.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...reply.getHeaders(),
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    });
    let closed = false;
    let keepalive = null;
    const off = ws.jobs.subscribe((e) => {
      if (closed) return;
      res.write(`event: ${e.type}\ndata: ${dumps(e)}\n\n`);
      armKeepalive();
      if (e.type === "done") finish();
    });
    const armKeepalive = () => {
      clearTimeout(keepalive);
      keepalive = setTimeout(() => {
        if (closed) return;
        res.write(": keepalive\n\n");
        armKeepalive();
      }, 15000);
    };
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(keepalive);
      off();
      res.end();
    };
    res.on("close", finish);
    res.write(`event: hello\ndata: ${dumps(ws.jobs.status())}\n\n`);
    armKeepalive();
  });

  // ── the Google Translate frame ─────────────────────────────────────────────

  /**
   * The minimal page the Google Translate widget runs in — the widget translates the WHOLE
   * document it is loaded into, so a page containing nothing but the string is what makes it
   * usable. Same-origin, so the parent reads the result.
   */
  app.get(
    "/v1/gt-frame",
    { schema: q({ text: T.Optional(T.String({ default: "" })), tl: T.Optional(T.String({ default: "es" })) }) },
    async (req, reply) => {
      const { text = "", tl = "es" } = req.query;
      const esc = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      reply.type("text/html; charset=utf-8");
      return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>gt</title>
<style> body { font: 15px/1.5 system-ui, sans-serif; margin: 8px; color-scheme: light dark; }
 #src { padding: 8px; border-radius: 6px; }</style></head><body>
<div id="google_translate_element"></div>
<div id="src">${esc}</div>
<script>
 window.__tl = ${dumps(tl)};
 function googleTranslateElementInit() { new google.translate.TranslateElement({ pageLanguage: 'en' }, 'google_translate_element'); }
</script>
<script src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
</body></html>`;
    },
  );
}

