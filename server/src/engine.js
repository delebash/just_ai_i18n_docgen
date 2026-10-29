// SPDX-License-Identifier: MIT
// The engine seam — where the loop's `send` meets the shared LLM stack. The port of
// engine.py.
//
// The Node tool owned its whole transport (`buildRequest`/`callModel`) because owning the
// request body was the only cure for invisible request damage. Here the body is owned by
// the kit's adapters, and every knob the old engines.json carried lives in the ENGINE PRESET
// the feature points at (one-source: the preset owns provider+model+temperature/think/samplers).
//
// Since 2026-10-29 a send is the kit's runAction over the action's PROMPT ROW
// (seed_feature_prompts.js): the row's texts rendered with the caller's {{variables}}, the
// preset's every tunable, its JSON contract as the OpenAI `response_format`, the built-in
// engine's model made resident first, the busy guard and the usage ledger — §19's "Run a chat
// feature", the way house-paint runs its schemes. Until then docgen built the prompt and
// called the adapter itself.
//
// So this module is deliberately thin: check the row and the preset once, then one runAction
// per call. It exists as a seam so the loop stays testable without a model and the resolution
// logic has one home — "ONE engine resolver, used by both doors" survives.
//
// THE PROBE GUARD LIVES HERE, reading the RESOLVED PRESET. The Node version refused `--probe`
// at effective temperature 0 by reading the BUILT request body, because a second copy of the
// merge rules would drift. The preset is now the one source the body is built from, so the
// guard reads it — same principle, new single source. It resolves the FEATURE's preset and
// runAction the ACTION's: each row's key is its feature (seed_feature_prompts.js), so both
// read the same preset (tests/prompts.test.js holds it).

import { buildLlmConfig, LLMNotConfiguredError, render, runAction } from "@delebash/core/llm";
import * as presetResolve from "@delebash/core/llm/preset_resolve";
import { MissingTemplateVariables, UnknownActionError, UnknownPresetError } from "@delebash/core/llm/prompts";
import * as registry from "@delebash/core/llm/registry";
import * as stores from "@delebash/core/llm/stores";
import { errText, RuntimeError, strip, truthy } from "@delebash/core/platform/py";
import { DEFAULT_FEATURE_PROMPTS } from "./seed_feature_prompts.js";

/** Raised when a feature resolves to no usable preset/adapter — loudly, with the fix in the
 * message, never a silent fallback to some other engine. */
export class EngineNotConfigured extends RuntimeError {
  constructor(message) {
    super(message);
    this.name = "EngineNotConfigured";
    // no retry fixes a setting: the translate loop stops on it (loop.js), never spends its ladder
    this.fatal = true;
  }
}

/**
 * [adapter, preset] for a feature, or a loud failure naming what is missing.
 *
 * `presetId` is the ESCALATION door: re-doing flagged keys with a stronger engine means
 * pointing at a specific preset rather than the feature's assigned one — the old
 * `--escalate <profile>` became "escalate to a preset", same one-resolver rule.
 */
export function resolveEngine(feature = "translate", presetId = null) {
  let preset;
  if (truthy(presetId)) {
    preset = stores.getEnginePresetStore().list().find((p) => p.id === presetId) ?? null;
    if (preset === null) {
      throw new EngineNotConfigured(`no engine preset with id "${presetId}" — list them on the AI-features page.`);
    }
  } else {
    preset = presetResolve.resolveFeaturePreset(feature);
  }
  if (preset == null) {
    throw new EngineNotConfigured(
      `feature "${feature}" resolves to no engine preset — assign one on the ` +
        "AI-features page (or check the seeded default_preset_id).",
    );
  }
  const adapter = registry.getLlmRegistry().get(preset.providerId);
  if (adapter == null) {
    throw new EngineNotConfigured(
      `preset "${preset.name}" points at provider "${preset.providerId}", which is ` +
        "not registered — configure the provider (Settings → AI) or point the preset " +
        "at one that exists.",
    );
  }
  return [adapter, preset];
}

/** The {{names}} a template uses, as the kit's renderer reads them (its fail-loud error names every one). */
function namesIn(template) {
  try {
    render(template, {});
    return [];
  } catch (e) {
    if (e instanceof MissingTemplateVariables) return e.names;
    throw e;
  }
}

/**
 * The row an action runs, checked before its run starts: there, with {{items}} (the strings it sends go there), its
 * JSON contract on (the answer is parsed as JSON), and naming no {{variable}} its run doesn't fill — the run fills
 * the names its seeded row uses. A row saved in the Lab without one of those failed every key, and only after the
 * whole retry ladder (about ten minutes on JustWrite's catalogue); now the run is refused, named, with the fix.
 * Throws EngineNotConfigured: a route's 400, the CLI's error.
 */
export function checkPromptRow(action) {
  const row = stores.getPromptStore().get(action) ?? null;
  const seed = DEFAULT_FEATURE_PROMPTS[action];
  const what = `the "${action}" prompt (the AI page, Routing by feature)`;
  if (row === null || !seed) throw new EngineNotConfigured(`there is no "${action}" prompt — restart the app to seed it.`);
  const text = `${row.system}\n${row.user_template}`;
  const uses = namesIn(text);
  if (!uses.includes("items")) {
    throw new EngineNotConfigured(`${what} has no {{items}} — the strings it sends go there. Put {{items}} back, or press Reset to default.`);
  }
  if (!row.json_mode) {
    throw new EngineNotConfigured(`${what} must answer in JSON — turn "Output as JSON" back on, or press Reset to default.`);
  }
  const fills = namesIn(`${seed.system}\n${seed.user_template}`);
  const unknown = uses.filter((n) => !fills.includes(n));
  if (unknown.length) {
    const list = (names) => names.map((n) => `{{${n}}}`).join(", ");
    throw new EngineNotConfigured(`${what} uses ${list(unknown)}, which its run doesn't fill — it fills ${list(fills)}.`);
  }
}

/**
 * The loop's async `send(variables) -> str`: the action's prompt row rendered with `variables`, run by the kit's
 * runAction on the resolved preset (`presetId`: escalation's chosen one, run whole — the kit's RunRequest presetId).
 *
 * Resolution happens PER CALL, not at closure build: a preset or a prompt edited mid-run (or a provider
 * re-registered) is picked up on the next batch, and the closure holds no stale adapter reference across an
 * hour-long catalogue. Checked once now as well, so a run with no usable engine or a broken prompt is refused before
 * it starts (a route's 400, the CLI's error) — until 2026-10-29 only each call resolved, and an unconfigured engine
 * spent the whole retry ladder on every key.
 */
export function makeSend(action = "translate", presetId = null) {
  resolveEngine(action, presetId);
  checkPromptRow(action);
  return async function send(variables) {
    // the preset and the prompt again: one deleted or broken mid-run (a Lab save) ends the run, named — never
    // swapped for the default route, never a ladder spent on every key
    resolveEngine(action, presetId);
    checkPromptRow(action);
    let response;
    try {
      response = await runAction(stores.getPromptStore(), buildLlmConfig(), {
        action,
        variables,
        ...(truthy(presetId) ? { presetId } : {}),
      });
    } catch (e) {
      // what no retry fixes — a prompt a Lab save broke mid-run, a preset or a route gone — ends the run, named
      if (e instanceof MissingTemplateVariables) throw new EngineNotConfigured(`the "${action}" prompt: ${errText(e)}`);
      if (e instanceof UnknownActionError || e instanceof UnknownPresetError || e instanceof LLMNotConfiguredError) {
        throw new EngineNotConfigured(errText(e));
      }
      // the built-in engine refusing its model (the kit's `localNotReady`: just stopped by you, the engine not
      // installed, a load that failed or timed out) — retried per key, each try would load the model again
      if (e?.localNotReady) throw new EngineNotConfigured(errText(e));
      throw e;
    }
    const text = response.text;
    if (typeof text !== "string" || !strip(text)) {
      throw new RuntimeError(
        "Empty content from the engine. A thinking model with no output budget " +
          "does this — check the preset's think toggle.",
      );
    }
    return text;
  };
}

/** The temperature the resolved preset will send. null means the provider's own default
 * applies (non-zero for every shipped provider). */
export function presetTemperature(feature = "translate") {
  const [, preset] = resolveEngine(feature);
  return preset.temperature;
}

/**
 * Refuse rather than mislead: the probe measures the engine's uncertainty by sampling it
 * twice, and at temperature 0 the two passes are identical by construction — the result
 * would be a meaningless all-clear. Guarded on the RESOLVED preset, the one source the
 * request is built from.
 */
export function requireProbeTemperature(feature = "translate") {
  const t = presetTemperature(feature);
  if (t === 0) {
    throw new EngineNotConfigured(
      "the probe needs a non-zero sampling temperature: it compares two samples of " +
        "the same engine, and at temperature 0 they are identical by construction, so " +
        `the result would be a meaningless all-clear. The "${feature}" preset's ` +
        "temperature is 0 — raise it in the preset, or drop the probe.",
    );
  }
}
