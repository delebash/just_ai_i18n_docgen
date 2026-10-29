// SPDX-License-Identifier: MIT
// The review workspace API — the project surface, a run's start, and the GT frame. The port of
// api/workspace_api.py. A run is the kit's job (jobs.js): what runs, one run, its events and
// its cancel are the kit's /v1/jobs routes (makeJobsRouter, mounted in app.js).
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

import { aiRunHttpError } from "@delebash/core/llm";
import { Hono, input } from "@delebash/core/platform";
import { ApiError, conflict, notFound, RequestValidationError } from "@delebash/core/platform/errors";
import { errText, pyGet, pyIter, pySorted, RuntimeError, truthy, ValueError } from "@delebash/core/platform/py";
import { pyJson } from "@delebash/core/platform/pyjson";
import * as appmeta from "../appmeta.js";
import { acceptanceEntry, acceptanceHash, loadAccepted, saveAccepted } from "../accepted.js";
import { getState } from "../app_state.js";
import { buildContext, checkOne, isTranslated } from "../checks.js";
import { CONFIRM_CODE, confirmIdentical, makeAsk } from "../confirm.js";
import * as engine from "../engine.js";
import { JobBusyError, startTranslateRun, TRANSLATE } from "../jobs.js";
import { firstOf, flatten, pyStr } from "../jsonio.js";
import {
  AcceptIn,
  ApplyIn,
  BacktranslateIn,
  DiscardIn,
  GtFrameQuery,
  LangQuery,
  NoteIn,
  ProposalsQuery,
  ReferenceQuery,
  RunIn,
  SaveIn,
  SiblingsQuery,
  TermsQuery,
  TestVariablesQuery,
  UnacceptIn,
  UndoIn,
} from "../schemas/workspace.js";
import { backtranslateVariables, parseItems } from "../shieldlib.js";
import { runCfg, unfilteredFindings } from "../service.js";
import { recordSources } from "../sources.js";
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
import { _glossaryList, _UNLIMITED, labVariables } from "../workspace.js";
import * as self from "./workspace_api.js";

/** The engine seam Python's tests patch on this module. */
export const makeSend = (action = "translate", presetId = null) => engine.makeSend(action, presetId);

/** A request's own field the server alone can judge, refused in a 422 under it (app-structure §15). */
const fieldError = (loc, msg, type = "value_error") => new RequestValidationError([{ type, loc, msg }]);

/**
 * The engine's own failures on an AI route: the kit's 503/502 when the model isn't ready or the provider can't be
 * reached (`aiRunHttpError`), a 400 for an engine or a prompt the user has to set up, a 502 for an answer that
 * wasn't usable (a reply that isn't JSON is a ValueError; EngineNotConfigured is a RuntimeError, so it goes first).
 */
export function engineFailure(e) {
  const kit = aiRunHttpError(e);
  if (kit) return kit;
  if (e instanceof engine.EngineNotConfigured) {
    return new ApiError(400, "engine-not-configured", "The AI engine isn't set up", errText(e));
  }
  if (e instanceof RuntimeError || e instanceof ValueError) {
    return new ApiError(502, "engine-answer-unusable", "The engine's answer wasn't usable", errText(e));
  }
  return e;
}

/** The loaded project, or the 409 that sends the UI to Setup (its `needsSetup` member says so). */
export function project() {
  const ws = getState().workspace;
  if (ws.project === null) {
    throw new ApiError(409, "needs-setup", "No project loaded", "no project loaded yet", { needsSetup: true });
  }
  // Every project route passes here — the one seam where an externally changed en.json (CLI
  // extract, git, an editor) gets picked up.
  ws.project.refreshSourceIfChanged();
  return ws.project;
}

/** `lang or p.targets[0]` */
const langOr = (lang, p) => (truthy(lang) ? lang : firstOf(pyIter(p.targets)));

export function router() {
  const app = new Hono();
  // ── the project surface ────────────────────────────────────────────────────

  // (what runs is the kit's GET /v1/jobs?kind=translate — one way to ask, round D2)
  app.get("/v1/state", async (c) => {
    const p = project();
    const targets = pyIter(p.targets);
    return c.json({
      langs: p.targets,
      source: pyGet(p.cfg, "sourceLanguage"),
      progress: Object.fromEntries(targets.map((lg) => [lg, reviewProgress(p.state, lg)])),
      proposals: Object.fromEntries(targets.map((lg) => [lg, proposalCount(p.state, lg)])),
    });
  });

  /**
   * The Lab's test input (the kit's FeatureLab, its language picker — boot/docgen.js): the {{variables}} a real run
   * of `action` sends, over a small live sample of `lang` (workspace.js labVariables). Loud named 400s; 409
   * needsSetup like every project route. It replaced POST /v1/ai/prompt-preview (2026-10-29), when the prompts
   * became editable rows.
   */
  app.get("/v1/ai/test-variables", input({ querystring: TestVariablesQuery }), async (c) => {
    const { action, lang } = c.req.valid("query");
    return c.json({ variables: labVariables(project(), action, lang) });
  });

  app.get("/v1/rows", input({ querystring: LangQuery }), async (c) => {
    project();
    return c.json(getState().workspace.buildRows(c.req.valid("query").lang ?? null));
  });

  /**
   * The dashboard's one call: per-language done/total, findings, review state and the last
   * run — light enough to refresh after every job. Counts only; /rows is the page that
   * carries the strings.
   */
  app.get("/v1/summary", async (c) => {
    const ws = getState().workspace;
    const p = project();
    const langs = [];
    for (const lg of pyIter(p.targets)) {
      const targetFlat = p.targetFlat(lg) ?? new Map();
      const [, findings, accepted] = ws.findingsFor(lg);
      const statuses = reviewStatuses(p.state, lg);
      const translated = new Set();
      for (const [k, src] of p.src) if (isTranslated(src, targetFlat.get(k))) translated.add(k);
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
    return c.json({
      source: pyGet(p.cfg, "sourceLanguage"),
      keyCount: p.src.size,
      configPath: p.configPath,
      langs,
    });
  });

  app.get("/v1/accepted", input({ querystring: LangQuery }), async (c) => {
    const p = project();
    const lg = langOr(c.req.valid("query").lang, p);
    const entries = loadAccepted(p.paths.acceptedFile(lg));
    return c.json({ lang: lg, entries: Object.entries(entries).map(([h, e]) => ({ hash: h, ...e })) });
  });

  app.post("/v1/save", input({ body: SaveIn }), async (c) => {
    const { lang, key, value } = c.req.valid("json");
    const ws = getState().workspace;
    const p = project();
    if (!p.src.has(key)) throw notFound(`no such key: ${key}`);
    const prev = (p.targetFlat(lang) ?? new Map()).get(key) ?? null;
    ws.writeKey(lang, key, value);
    recordAction(p.state, { lang, key, kind: "edit", prev, nextValue: value });
    setReviewStatus(p.state, { lang, key, status: "reviewed" });
    const flags = checkOne({ key, src: p.src.get(key), dst: value, ctx: buildContext(p.cfg, p.conventions, lang) }).map(
      (f) => ({ code: f.code, detail: f.detail }),
    );
    return c.json({ key, lang, flags });
  });

  /**
   * Records findings as reviewed-and-correct. BULK IS THE POINT: a fresh catalogue raises
   * ~70 `untranslated` findings that are almost all correct output, and seventy clicks is
   * what makes someone reach for a script — making the honest path cheap is what stops that.
   * ONE CALL IS ONE UNDO: the batch records a single bulk-accept holding every hash it added.
   * `by` comes from the app's reviewer setting — never the OS username.
   */
  app.post("/v1/accept", input({ body: AcceptIn }), async (c) => {
    const { lang, key, keys } = c.req.valid("json");
    const ws = getState().workspace;
    const p = project();
    const wanted = keys ?? (key !== undefined ? [key] : []);
    if (!wanted.length) throw fieldError(["body", "keys"], "Name a key, or keys[]", "missing");
    const missing = wanted.filter((k) => !p.src.has(k));
    if (missing.length) throw notFound(`no such key: ${missing.join(", ")}`);

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
    // Accepted as right for TODAY's English: what each translation is now taken to be made from
    // (sources.js — a `source-changed` finding accepted is answered, and the next change flags again).
    recordSources(p.paths.cachePath, lang, new Map(wanted.filter((k) => targetFlat.has(k)).map((k) => [k, p.src.get(k)])));
    return c.json({ lang, keys: wanted, recorded: added.length, by: by || null });
  });

  /**
   * The fix for the complaint that started the Node rebuild: an acceptance was one-way, and
   * accepted keys vanished from the page, so a decision could never be revisited.
   */
  app.delete("/v1/accept", input({ body: UnacceptIn }), async (c) => {
    const { lang, key, code = null } = c.req.valid("json");
    const p = project();
    const path = p.paths.acceptedFile(lang);
    const store = loadAccepted(path);
    const removed = {};
    for (const [h, e] of Object.entries(store)) {
      if (e.key === key && (code === null || e.code === code)) removed[h] = e;
    }
    for (const h of Object.keys(removed)) delete store[h];
    saveAccepted(path, store);
    recordAction(p.state, { lang, key, kind: "unaccept", prev: removed });
    return c.json({ key, lang, removed: Object.keys(removed).length });
  });

  app.post("/v1/undo", input({ body: UndoIn }), async (c) => {
    const ws = getState().workspace;
    const p = project();
    const a = popAction(p.state, { lang: c.req.valid("json").lang ?? null });
    if (a === null) throw notFound("nothing to undo");
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
    return c.json({ undone: a });
  });

  app.get("/v1/history", input({ querystring: LangQuery }), async (c) =>
    c.json({ actions: actionHistory(project().state, { lang: c.req.valid("query").lang ?? null }) }),
  );

  app.get("/v1/proposals", input({ querystring: ProposalsQuery }), async (c) => {
    const query = c.req.valid("query");
    const p = project();
    const lg = langOr(query.lang, p);
    return c.json({ lang: lg, proposals: proposals(p.state, { lang: lg, key: query.key ?? null }) });
  });

  app.post("/v1/proposals/apply", input({ body: ApplyIn }), async (c) => {
    const ws = getState().workspace;
    const p = project();
    const { lang, keys } = c.req.valid("json");
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
    return c.json({ lang, applied });
  });

  app.delete("/v1/proposals", input({ body: DiscardIn }), async (c) => {
    const p = project();
    const { lang, keys = null } = c.req.valid("json");
    // Discard destroys staged work by hand, so it is UNDOABLE like every other human action
    // (audit 2026-08-05: it recorded nothing — the next undo silently reversed some OLDER
    // action instead). prev holds the dropped rows; undo re-stages them. The count is what
    // was actually dropped, never keys.length (a key with no proposal is not a discard).
    const wanted = keys === null ? null : new Set(keys);
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
    return c.json({ lang, discarded: dropped.length });
  });

  /**
   * How characterAudit.why was actually proven a defect: its sibling renders the same
   * label-with-colon pattern correctly. A reviewer needs that view.
   */
  app.get("/v1/siblings", input({ querystring: SiblingsQuery }), async (c) => {
    const query = c.req.valid("query");
    const { key } = query;
    const p = project();
    const lg = langOr(query.lang, p);
    const ns = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "";
    const targetFlat = p.targetFlat(lg) ?? new Map();
    // (A top-level key's namespace is "" — its "siblings" are keys starting with ".", as in
    // Python.)
    const sibs = [...p.src]
      .filter(([k]) => k !== key && k.startsWith(`${ns}.`) && !k.slice(ns.length + 1).includes("."))
      .slice(0, 25)
      .map(([k, src]) => ({ key: k, source: src, target: targetFlat.get(k) ?? "" }));
    return c.json({ key, namespace: ns, siblings: sibs });
  });

  app.get("/v1/terms", input({ querystring: TermsQuery }), async (c) => {
    const query = c.req.valid("query");
    const { key = null, term = null } = query;
    const p = project();
    const lg = langOr(query.lang, p);
    const targetFlat = p.targetFlat(lg) ?? new Map();
    if (truthy(term)) return c.json({ term, usage: termUsage({ sourceFlat: p.src, targetFlat, term }) });
    if (!truthy(key)) throw fieldError(["query", "key"], "Name a key or a term", "missing");
    const { index } = checkTerms({ sourceFlat: p.src, targetFlat });
    return c.json({
      key,
      findings: checkKeyTerms({ key, src: p.src.get(key) ?? "", dst: targetFlat.get(key) ?? null, index }),
    });
  });

  app.put("/v1/notes", input({ body: NoteIn }), async (c) => {
    const ws = getState().workspace;
    const p = project();
    const { lang, key, note: n = null } = c.req.valid("json");
    const note = truthy(n) ? n : null;
    const prev = flatten(p.readNotes(lang)).get(key) ?? null;
    ws.writeNote(lang, key, note);
    recordAction(p.state, { lang, key, kind: "note", prev, nextValue: note });
    return c.json({ lang, key, note });
  });

  app.get("/v1/runs", input({ querystring: LangQuery }), async (c) =>
    c.json({ runs: runHistory(project().state, { lang: c.req.valid("query").lang ?? null }) }),
  );

  app.get(
    "/v1/reference",
    input({ querystring: ReferenceQuery }),
    async (c) => {
      const query = c.req.valid("query");
      const { key, engine: eng = "backtranslate" } = query;
      const p = project();
      const lg = langOr(query.lang, p);
      return c.json({ key, lang: lg, engine: eng, cached: getReference(p.state, { lang: lg, key, engine: eng }) });
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
  app.post("/v1/backtranslate", input({ body: BacktranslateIn }), async (c) => {
    const p = project();
    const { lang, key } = c.req.valid("json");
    const dst = (p.targetFlat(lang) ?? new Map()).get(key);
    if (!dst) throw notFound(`no translation for ${key}`);
    const cached = getReference(p.state, { lang, key, engine: "backtranslate" });
    if (truthy(cached)) return c.json({ key, lang, english: cached.value, cached: true });
    let english;
    try {
      // the review row (seed_feature_prompts.js BACKTRANSLATE_PROMPT), on the review feature's preset
      const send = self.makeSend("review");
      const out = await send(backtranslateVariables(dst, p.cfg, lang));
      english = parseItems(out).get(0);
    } catch (e) {
      // A dead second opinion must never block reviewing: the engine's failure is the answer, named.
      throw engineFailure(e);
    }
    if (!english) {
      throw new ApiError(502, "engine-answer-unusable", "The engine's answer wasn't usable", "the engine returned nothing usable");
    }
    putReference(p.state, { lang, key, engine: "backtranslate", value: english });
    return c.json({ key, lang, english, cached: false });
  });

  // ── a run's start ──────────────────────────────────────────────────────────

  /** Starts a translation run: 202 with the job's snapshot (the kit's job contract — the screen's
   *  runServerJob follows it from there), 409 while one runs. */
  app.post("/v1/jobs", input({ body: RunIn }), async (c) => {
    // the scope is the schema's: a typo is refused before it can start a job (schemas/workspace.js SCOPES)
    const { lang, scope = "flagged", keys = null, presetId = null } = c.req.valid("json");
    const ws = getState().workspace;
    const p = project();
    const targets = pyIter(p.targets);
    if (!targets.includes(lang)) {
      throw fieldError(["body", "lang"], `unknown language: ${pyStr(lang)} — this project translates into ${targets.join(", ")}`);
    }
    const { jobs } = getState();
    if (jobs.busy([TRANSLATE])) throw conflict("a job is already running");

    let wanted;
    if (scope === "keys") wanted = truthy(keys) ? pyIter(keys) : [];
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
    if (!subset.size) throw new ApiError(400, "nothing-selected", "Nothing to translate", "that scope selected no keys");

    // THE two-resolver fix, structural now: the job resolves through the SAME seam the CLI
    // uses. presetId is the escalate-from-the-page door.
    let send;
    try {
      send = self.makeSend("translate", presetId);
    } catch (e) {
      throw engineFailure(e);
    }
    // the conventions line and the reviewer's notes, as the CLI's run sends them
    const cfg = runCfg(p, lang);

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
          context: pyGet(p.cfg, "context", ""),
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
      status = startTranslateRun(jobs, {
        store: p.state,
        lang,
        engine: truthy(presetId) ? presetId : "translate",
        send,
        scope,
        subset,
        cfg,
        // the window that started it (the kit's X-Client-Id): its end is that window's change, the others read again
        clientId: c.req.header("x-client-id") || null,
        confirm: confirmPass,
      });
    } catch (e) {
      if (e instanceof JobBusyError) throw conflict(errText(e));
      throw e;
    }
    return c.json(status, 202);
  });

  // ── the Google Translate frame ─────────────────────────────────────────────

  /**
   * The minimal page the Google Translate widget runs in — the widget translates the WHOLE
   * document it is loaded into, so a page containing nothing but the string is what makes it
   * usable. Same-origin, so the parent reads the result.
   */
  app.get(
    "/v1/gt-frame",
    input({ querystring: GtFrameQuery }),
    async (c) => {
      const { text = "", tl = "es" } = c.req.valid("query");
      const esc = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>gt</title>
<style> body { font: 15px/1.5 system-ui, sans-serif; margin: 8px; color-scheme: light dark; }
 #src { padding: 8px; border-radius: 6px; }</style></head><body>
<div id="google_translate_element"></div>
<div id="src">${esc}</div>
<script>
 window.__tl = ${pyJson(tl)};
 function googleTranslateElementInit() { new google.translate.TranslateElement({ pageLanguage: 'en' }, 'google_translate_element'); }
</script>
<script src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
</body></html>`;
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    },
  );
  return app;
}

