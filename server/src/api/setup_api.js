// SPDX-License-Identifier: MIT
// /v1/setup/* + /v1/reviewer — the no-project surface. The port of api/setup_api.py.
//
// Setup works with NO project — it is the screen that CREATES one. The reviewer identity
// rides here too: the Setup screen asks for it and `/setup/state` returns it, so a verdict
// can say who made it (never the OS username).

import path from "node:path";
import { Hono, input } from "@delebash/core/platform";
import { RequestValidationError } from "@delebash/core/platform/errors";
import { LANGUAGE_CODES } from "@delebash/core/platform/languages";
import { errText, FileNotFoundError, isDict, pyGet, pyTypeName, strip, truthy, ValueError } from "@delebash/core/platform/py";
import * as appmeta from "../appmeta.js";
import { getState } from "../app_state.js";
import { gitignoreLines, planInit, writeInit } from "../init.js";
import { flatten, mergeDicts, readJson, toPlain } from "../jsonio.js";
import { exists } from "../paths.js";
import { InspectIn, ReviewerIn, SetupIn } from "../schemas/setup.js";
import { _glossaryList } from "../workspace.js";

/** The path box's text, its whitespace and quotes trimmed (a path pasted from Explorer's "Copy as path" is quoted);
 *  nothing left is the field's own refusal, under it. */
const pathOf = (body) => {
  const p = strip(strip(body.path), "\"'");
  if (!p) throw pathError("give me the path to your en.json", "missing");
  return p;
};

/** A path the server can't use, said under the path box (a 422 at `["body", "path"]` — the form's fieldErrors). */
const pathError = (msg, type = "value_error") => new RequestValidationError([{ type, loc: ["body", "path"], msg }]);

/** FileNotFoundError / ValueError (no such file, not a locale catalog) → the path's own 422, in their words. */
function asPathError(e) {
  if (e instanceof FileNotFoundError || e instanceof ValueError) return pathError(errText(e));
  return e;
}

export function router() {
  const app = new Hono();
  app.get("/v1/setup/state", async (c) => {
    const p = getState().workspace.project;
    return c.json({
      loaded: p !== null,
      configPath: p ? p.configPath : null,
      source: p ? p.paths.sourceFile : null,
      langs: p ? p.targets : [],
      // Prefill, not decoration: an edit screen that shows blanks over a configured project
      // invites "save" to feel like it erased something.
      context: p ? (truthy(pyGet(p.cfg, "context")) ? pyGet(p.cfg, "context") : "") : "",
      // ALWAYS a bare list on the wire: the loaded cfg normalizes a list to {"doNotTranslate":
      // [...]} (infer.js), and handing that dict to the UI blew up the Setup prefill and let a
      // Save erase the real glossary (found by the 2026-08-05 audit).
      glossary: p ? _glossaryList(p.cfg) : [],
      reviewer: appmeta.getReviewer(),
      // Codes only. The display name is derived in the browser from Intl.DisplayNames, so the
      // menu reads in the user's own language and no English name can go stale here.
      // the family's languages (the kit's list since 2026-10-18; this file's config/languages.json until then)
      languages: [...LANGUAGE_CODES],
    });
  });

  /**
   * Reads a candidate en.json and reports what it found. Writes NOTHING — the live
   * validation behind the path box. Seeing that the tool understood your catalogue is what
   * proves the path is right before an hour of engine time proves it was not.
   */
  app.post("/v1/setup/inspect", input({ body: InspectIn }), async (c) => {
    const p = pathOf(c.req.valid("json"));
    let plan;
    try {
      plan = planInit(p);
    } catch (e) {
      throw asPathError(e);
    }
    const locales = [];
    for (const code of plan.existingTargets) {
      const target = path.join(plan.localesDir, `${code}.json`);
      const flat = exists(target) ? flatten(readJson(target)) : new Map();
      let done = 0;
      for (const k of plan.sourceFlat.keys()) {
        const v = flat.get(k);
        if (typeof v === "string" && v !== "") done += 1;
      }
      locales.push({ code, done, total: plan.keyCount, missing: plan.keyCount - done });
    }
    return c.json({
      ok: true,
      source: plan.localesDir,
      sourceLanguage: plan.sourceLanguage,
      keyCount: plan.keyCount,
      placeholder: plan.placeholder,
      pluralSeparator: plan.pluralSeparator,
      // NOT pre-selected: an existing file is a fact about the folder, not a decision about
      // what to run.
      locales,
      candidates: plan.candidates,
      configPath: plan.configPath,
      exists: exists(plan.configPath),
      gitignore: gitignoreLines(),
    });
  });

  /**
   * Writes the config and LOADS it, so the page goes live without a restart. Editing an
   * existing project comes through here too, and the MERGE is the important part: whatever
   * the file already had that this screen does not manage is preserved — the UI is a writer,
   * never an owner.
   */
  app.post("/v1/setup/save", input({ body: SetupIn }), async (c) => {
    const body = c.req.valid("json");
    const ws = getState().workspace;
    const p = pathOf(body);
    // A field the caller DIDN'T send falls back to the EXISTING config's value, never to
    // planInit's defaults — the defaults overwrote the real glossary through the merge below
    // (found by the 2026-08-05 audit). The existing file is read for fallbacks BEFORE
    // planning; the merge still preserves every unmanaged key.
    const { targets: bodyTargets = null, context: bodyContext = null, glossary: bodyGlossary = null } = body;
    let plan;
    try {
      const probe = planInit(p);
      // Read in loads() form (a Map): the merge below writes it back in its own order.
      const existingCfg = exists(probe.configPath) ? readJson(probe.configPath) : new Map();
      const eTargets = pyGet(existingCfg, "targets");
      const eContext = pyGet(existingCfg, "context");
      plan = planInit(p, {
        targets: bodyTargets !== null ? bodyTargets : Array.isArray(eTargets) ? eTargets : null,
        context: bodyContext !== null ? bodyContext : typeof eContext === "string" ? eContext : null,
        glossary:
          bodyGlossary !== null
            ? bodyGlossary
            : pyGet(existingCfg, "glossary") !== null
              ? _glossaryList(toPlain(existingCfg))
              : null,
      });
    } catch (e) {
      throw asPathError(e);
    }
    const configPath = plan.configPath;
    const existing = exists(configPath) ? readJson(configPath) : new Map();
    if (!isDict(existing)) throw new TypeError(`'${pyTypeName(existing)}' object is not a mapping`);
    writeInit({ ...plan, cfg: mergeDicts(existing, plan.cfg) }, { force: true });
    ws.load(configPath);
    return c.json({ ok: true, configPath, langs: ws.project.targets });
  });

  app.get("/v1/reviewer", async (c) => c.json({ reviewer: appmeta.getReviewer() }));

  app.put("/v1/reviewer", input({ body: ReviewerIn }), async (c) => {
    appmeta.setReviewer(c.req.valid("json").reviewer);
    return c.json({ reviewer: appmeta.getReviewer() });
  });
  return app;
}
