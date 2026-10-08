// SPDX-License-Identifier: MIT
// /v1/setup/* + /v1/reviewer — the no-project surface. The port of api/setup_api.py.
//
// Setup works with NO project — it is the screen that CREATES one. The reviewer identity
// rides here too: the Setup screen asks for it and `/setup/state` returns it, so a verdict
// can say who made it (never the OS username).

import path from "node:path";
import { HttpError } from "@delebash/llm-runner/platform/errors";
import { FileNotFoundError, ValueError } from "@delebash/llm-runner/platform/py";
import * as appmeta from "../appmeta.js";
import { getState } from "../app_state.js";
import { gitignoreLines, planInit, writeInit } from "../init.js";
import {
  dget,
  errText,
  flatten,
  isDict,
  mergeDicts,
  pyStr,
  pyStrip,
  pyTruthy,
  readJson,
  stripChars,
  toPlain,
  typeName,
} from "../jsonio.js";
import { exists } from "../paths.js";
import { _glossaryList } from "../workspace.js";
import { BODY } from "./server_auth_api.js";

/** `str(body.get("path") or "").strip().strip("\"'")` */
const pathOf = (body) => {
  const p = dget(body, "path");
  return stripChars(pyStrip(pyStr(pyTruthy(p) ? p : "")), "\"'");
};

/** FileNotFoundError / ValueError → 400 with the message (Python's `except … as e: 400`). */
function asBadRequest(e) {
  if (e instanceof FileNotFoundError || e instanceof ValueError) return new HttpError(400, errText(e));
  return e;
}

export async function router(app) {
  app.get("/v1/setup/state", async () => {
    const languages = toPlain(readJson(path.join(import.meta.dirname, "..", "config", "languages.json")));
    const p = getState().workspace.project;
    return {
      loaded: p !== null,
      configPath: p ? p.configPath : null,
      source: p ? p.paths.sourceFile : null,
      langs: p ? p.targets : [],
      // Prefill, not decoration: an edit screen that shows blanks over a configured project
      // invites "save" to feel like it erased something.
      context: p ? (pyTruthy(dget(p.cfg, "context")) ? dget(p.cfg, "context") : "") : "",
      // ALWAYS a bare list on the wire: the loaded cfg normalizes a list to {"doNotTranslate":
      // [...]} (infer.js), and handing that dict to the UI blew up the Setup prefill and let a
      // Save erase the real glossary (found by the 2026-08-05 audit).
      glossary: p ? _glossaryList(p.cfg) : [],
      reviewer: appmeta.getReviewer(),
      // Codes only. The display name is derived in the browser from Intl.DisplayNames, so the
      // menu reads in the user's own language and no English name can go stale here.
      languages,
    };
  });

  /**
   * Reads a candidate en.json and reports what it found. Writes NOTHING — the live
   * validation behind the path box. Seeing that the tool understood your catalogue is what
   * proves the path is right before an hour of engine time proves it was not.
   */
  app.post("/v1/setup/inspect", { schema: { body: BODY } }, async (req) => {
    const p = pathOf(req.body);
    if (!p) throw new HttpError(400, "give me the path to your en.json");
    let plan;
    try {
      plan = planInit(p);
    } catch (e) {
      throw asBadRequest(e);
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
    return {
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
    };
  });

  /**
   * Writes the config and LOADS it, so the page goes live without a restart. Editing an
   * existing project comes through here too, and the MERGE is the important part: whatever
   * the file already had that this screen does not manage is preserved — the UI is a writer,
   * never an owner.
   */
  app.post("/v1/setup/save", { schema: { body: BODY } }, async (req) => {
    const body = req.body;
    const ws = getState().workspace;
    const p = pathOf(body);
    if (!p) throw new HttpError(400, "give me the path to your en.json");
    // A field the caller DIDN'T send falls back to the EXISTING config's value, never to
    // planInit's defaults — the defaults overwrote the real glossary through the merge below
    // (found by the 2026-08-05 audit). The existing file is read for fallbacks BEFORE
    // planning; the merge still preserves every unmanaged key.
    const bodyTargets = Array.isArray(dget(body, "targets")) ? dget(body, "targets") : null;
    const bodyContext = typeof dget(body, "context") === "string" ? dget(body, "context") : null;
    const bodyGlossary = Array.isArray(dget(body, "glossary")) ? dget(body, "glossary") : null;
    let plan;
    try {
      const probe = planInit(p);
      // Read in loads() form (a Map): the merge below writes it back in its own order.
      const existingCfg = exists(probe.configPath) ? readJson(probe.configPath) : new Map();
      const eTargets = dget(existingCfg, "targets");
      const eContext = dget(existingCfg, "context");
      plan = planInit(p, {
        targets: bodyTargets !== null ? bodyTargets : Array.isArray(eTargets) ? eTargets : null,
        context: bodyContext !== null ? bodyContext : typeof eContext === "string" ? eContext : null,
        glossary:
          bodyGlossary !== null
            ? bodyGlossary
            : dget(existingCfg, "glossary") !== null
              ? _glossaryList(toPlain(existingCfg))
              : null,
      });
    } catch (e) {
      throw asBadRequest(e);
    }
    const configPath = plan.configPath;
    const existing = exists(configPath) ? readJson(configPath) : new Map();
    if (!isDict(existing)) throw new TypeError(`'${typeName(existing)}' object is not a mapping`);
    writeInit({ ...plan, cfg: mergeDicts(existing, plan.cfg) }, { force: true });
    ws.load(configPath);
    return { ok: true, configPath, langs: ws.project.targets };
  });

  app.get("/v1/reviewer", async () => ({ reviewer: appmeta.getReviewer() }));

  app.put("/v1/reviewer", { schema: { body: BODY } }, async (req) => {
    const r = dget(req.body, "reviewer");
    if (r !== null && typeof r !== "string") throw new HttpError(400, "reviewer must be a string or null");
    appmeta.setReviewer(r);
    return { reviewer: appmeta.getReviewer() };
  });
}
