// SPDX-License-Identifier: MIT
// The engine seam — where the loop's `send` meets the shared LLM stack. The port of
// engine.py.
//
// The Node tool owned its whole transport (`buildRequest`/`callModel`) because owning the
// request body was the only cure for invisible request damage. Here the body is owned by
// llm-runner's adapters — `extra` routes per-provider exactly the way `extraBody` did, and
// every knob the old engines.json carried lives in the ENGINE PRESET the feature points at
// (one-source: the preset owns provider+model+temperature/think/samplers).
//
// So this module is deliberately thin: resolve the feature's preset, fetch the adapter,
// shape ONE call. It exists as a seam so the loop stays testable without a model and the
// resolution logic has one home — "ONE engine resolver, used by both doors" survives.
//
// THE PROBE GUARD LIVES HERE, reading the RESOLVED PRESET. The Node version refused `--probe`
// at effective temperature 0 by reading the BUILT request body, because a second copy of the
// merge rules would drift. The preset is now the one source the body is built from, so the
// guard reads it — same principle, new single source.

import { LLMMessage } from "@delebash/llm-runner/llm";
import * as presetResolve from "@delebash/llm-runner/llm/preset_resolve";
import * as registry from "@delebash/llm-runner/llm/registry";
import * as stores from "@delebash/llm-runner/llm/stores";
import { pyFloatParse, pyInt, RuntimeError, strip, truthy, ValueError } from "@delebash/llm-runner/platform/py";
import { RESPONSE_SCHEMA } from "./shieldlib.js";

/** Raised when a feature resolves to no usable preset/adapter — loudly, with the fix in the
 * message, never a silent fallback to some other engine. */
export class EngineNotConfigured extends RuntimeError {
  constructor(message) {
    super(message);
    this.name = "EngineNotConfigured";
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

/**
 * The structured-output knob — ONE shape for every provider: OpenAI-style
 * `response_format.json_schema`. The ADAPTERS own the per-provider translation (Ollama's
 * converts it to its native `format` field itself).
 *
 * This function used to fork per provider like the Node `buildRequest` did — and the live
 * E2E (2026-08-02) proved that wrong in one run: the hand-built raw `format` key fell into
 * the Ollama adapter's sampling-params branch, landed inside `options` where Ollama ignores
 * it, and the model freestyled non-schema JSON — 6 keys exhausted, exit 1 (correctly loud).
 * `providerType` is kept for signature stability and deliberately unused.
 */
export function structuredExtra(_providerType = "") {
  return {
    response_format: {
      type: "json_schema",
      json_schema: { name: "translations", strict: true, schema: RESPONSE_SCHEMA },
    },
  };
}

/**
 * The loop's async `send(system, user) -> str`, built from the resolved preset.
 *
 * Resolution happens PER CALL, not at closure build: a preset edited mid-run (or a provider
 * re-registered) is picked up on the next batch, and the closure holds no stale adapter
 * reference across an hour-long catalogue.
 */
export function makeSend(feature = "translate", presetId = null) {
  return async function send(system, user) {
    const [adapter, preset] = resolveEngine(feature, presetId);
    const response = await adapter.chat([LLMMessage("user", user)], {
      model: preset.model || null,
      temperature: preset.temperature,
      maxTokens: preset.maxTokens || null,
      system,
      think: preset.think,
      extra: { ...structuredExtra(adapter.provider_type), ...presetExtra(preset) },
    });
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

/**
 * A stored text sampler value → the JSON type the chat API expects (bool / int / float /
 * str). Empty → null. Faithful to the shared run path's parser (the kit's prompts.js, private
 * there, so ported rather than imported — the overnight re-review (2026-08-02) is when the
 * whole overlay was found missing here).
 */
function parseSamplerValue(v) {
  const s = strip(v || "");
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "true" || low === "false") return low === "true";
  try {
    return pyInt(s);
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
  }
  try {
    return pyFloatParse(s);
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
  }
  return s;
}

/**
 * The preset's remaining tunables as adapter `extra` — top_p, the long-tail samplers, and the
 * reasoning level, mirroring the shared run path's overlay (prompts' _plane2Extra). FOUND
 * MISSING by the overnight re-review: temperature and think reached the adapter while
 * topP/samplers/reasoningEffort were silently dropped — a user tuning topP in the Lab changed
 * nothing here. A half-honoured setting is this family's most-hated bug class; now every
 * preset field lands.
 */
export function presetExtra(preset) {
  const extra = {};
  const topP = preset?.topP ?? null;
  if (topP !== null) extra.top_p = topP;
  for (const row of preset?.samplers || []) {
    const name = strip(row?.flagName || "");
    if (name && !Object.hasOwn(extra, name)) {
      const val = parseSamplerValue(row?.flagValue || "");
      if (val !== null) extra[name] = val;
    }
  }
  // The reserved key's PRESENCE marks think-on for the adapters' reasoning mapping; "" is a
  // real state (FOLLOW the model's layered budget). Only under think.
  if (preset?.think) extra.reasoning_effort = preset.reasoningEffort || "";
  // The sampler ORDER is an array of names; accept the comma-joined knob string.
  if (typeof extra.samplers === "string") {
    extra.samplers = extra.samplers
      .split(",")
      .map((s) => strip(s))
      .filter((s) => s);
  }
  return extra;
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
