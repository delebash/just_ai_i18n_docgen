// SPDX-License-Identifier: MIT
// Port of tests/test_engine.py — the engine seam: resolution through the REAL seeded stores,
// one fake adapter.
//
// What must hold: a send is the action's seeded prompt row, rendered and run by the kit's
// runAction (2026-10-29); the seeded "translate" preset (temperature 0.2, the measured constant)
// reaches the adapter call verbatim; the structured output is one OpenAI shape for every
// provider; a broken row or a missing engine is refused before a run starts, and fatal when it
// breaks mid-run; failure is loud and names the fix; and the probe guard reads the RESOLVED
// preset — including a user's edit — never a constant.
import { LLMResponse, render } from "@delebash/core/llm";
import { setEnsureLocalModel } from "@delebash/core/llm/dispatch";
import { getLlmRegistry } from "@delebash/core/llm/registry";
import * as stores from "@delebash/core/llm/stores";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, seedLlmStack } from "../src/app.js";
import { EngineNotConfigured, makeSend, presetTemperature, requireProbeTemperature } from "../src/engine.js";
import { DEFAULT_FEATURE_PROMPTS } from "../src/seed_feature_prompts.js";
import { RESPONSE_SCHEMA, translateVariables } from "../src/shieldlib.js";
import { tmpDir, useHermeticKit } from "./helpers.js";

useHermeticKit();

class FakeAdapter {
  provider_id = "local-llamacpp"; // the id the seeded presets point at
  provider_type = "local-llamacpp";
  default_model = "fake-default";
  calls = [];

  async chat(messages, { model = null, temperature = 0.7, maxTokens = null, system = null, think = false, extra = null } = {}) {
    this.calls.push({ messages, model, temperature, maxTokens, system, think, extra });
    return LLMResponse({ text: JSON.stringify({ items: [{ id: 0, translation: "Hola" }] }), model: model || this.default_model });
  }
}

// The real app (seeded presets and prompt rows, real stores) + a fake adapter in the real registry.
let wired;
let saved;
beforeEach(async () => {
  await createApp(tmpDir()); // boots; the client itself is not needed
  seedLlmStack(); // the serve-time seed, explicit
  // no engine is installed here: the run's model load is a no-op (the ensure test below watches it)
  setEnsureLocalModel(async () => {});
  const reg = getLlmRegistry();
  wired = new FakeAdapter();
  saved = reg.get(wired.provider_id);
  reg.register(wired);
});
afterEach(() => {
  const reg = getLlmRegistry();
  if (saved !== null) reg.register(saved);
  else reg._adapters.delete(wired.provider_id);
});

const translatePreset = () => stores.getEnginePresetStore().list().find((p) => p.id === "p_translate");
const VARS = translateVariables([{ i: 0, key: "a", shielded: "Hello ⟦0⟧" }], { context: "a test app" }, "es", ["JustWrite"]);
/** Save a changed translate row, as the Lab's Save does. */
const saveRow = (key, change) => stores.getPromptStore().upsert({ key, ...stores.getPromptStore().get(key), ...change });

test("send_runs_the_seeded_row_on_the_seeded_preset", async () => {
  const send = makeSend("translate");
  const out = await send(VARS);
  expect(JSON.parse(out).items[0].translation).toBe("Hola");

  const call = wired.calls[0];
  const row = DEFAULT_FEATURE_PROMPTS.translate;
  expect(call.system, "the row's system text, rendered").toBe(render(row.system, VARS));
  expect(call.messages.at(-1).content, "the row's user template, rendered").toBe(render(row.user_template, VARS));
  // The MEASURED constant, delivered from the SEEDED preset — one source, no drift.
  expect(call.temperature).toBe(0.2);
  expect(call.think).toBe(false);
});

test("every_row_sends_one_openai_response_format_the_adapters_translate", async () => {
  // ONE OpenAI-style response_format for every provider — the adapters own the per-provider
  // translation (Ollama's converts it to `format` itself). The old per-provider fork here put
  // a raw `format` key into the adapter's sampling-params branch, where Ollama ignored it —
  // found LIVE by the first real E2E run: 6 of 6 keys exhausted every retry.
  for (const action of ["translate", "confirm", "review"]) {
    const vars = Object.fromEntries(
      [...`${DEFAULT_FEATURE_PROMPTS[action].system}${DEFAULT_FEATURE_PROMPTS[action].user_template}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => [m[1], "x"]),
    );
    await makeSend(action)(vars);
    const { extra } = wired.calls.at(-1);
    expect(extra.response_format.type, action).toBe("json_schema");
    expect(extra.response_format.json_schema.schema, action).toEqual(RESPONSE_SCHEMA);
    expect("format" in extra, action).toBe(false);
  }
});

test("empty_engine_reply_fails_loudly_naming_the_think_toggle", async () => {
  wired.chat = async () => LLMResponse({ text: "", model: "m" });
  await expect(makeSend("translate")(VARS)).rejects.toThrow(/think/);
});

test("missing_provider_fails_loudly_naming_the_fix", async () => {
  // refused when the send is made — before a run starts (2026-10-29: only each call checked, and an
  // unconfigured engine spent the whole retry ladder on every key)
  getLlmRegistry()._adapters.delete("local-llamacpp");
  expect(() => makeSend("translate")).toThrow(/not registered/);
});

test("a_provider_gone_mid_run_still_fails_the_call_and_is_fatal_to_the_loop", async () => {
  const send = makeSend("translate");
  getLlmRegistry()._adapters.delete("local-llamacpp");
  const err = await send(VARS).catch((e) => e);
  expect(err).toBeInstanceOf(EngineNotConfigured);
  expect(err.fatal).toBe(true);
});

test("a_row_saved_without_its_items_or_json_or_with_a_name_no_run_fills_is_refused_before_the_run", () => {
  // A Lab save that dropped {{items}}, turned JSON off or named a variable the run never fills failed every key,
  // after the whole retry ladder (about ten minutes on JustWrite) — refused now, named, with the fix.
  const seeded = stores.getPromptStore().get("translate");
  saveRow("translate", { user_template: "Context: {{context}}. Translate these." });
  expect(() => makeSend("translate")).toThrow(/\{\{items\}\}/);
  saveRow("translate", { user_template: seeded.user_template, json_mode: false });
  expect(() => makeSend("translate")).toThrow(/JSON/);
  saveRow("translate", { json_mode: true, system: `${seeded.system} Write like {{author}}.` });
  expect(() => makeSend("translate")).toThrow(/\{\{author\}\}/);
  saveRow("translate", { system: seeded.system });
  expect(() => makeSend("translate")).not.toThrow();
});

test("a_row_broken_mid_run_ends_the_run_instead_of_spending_the_ladder", async () => {
  const send = makeSend("translate");
  const seeded = stores.getPromptStore().get("translate");
  saveRow("translate", { system: "Translate as {{author}} would." });
  let err = await send(VARS).catch((e) => e);
  expect(err).toBeInstanceOf(EngineNotConfigured);
  expect(err.fatal).toBe(true);
  expect(err.message).toContain("author");
  // a save that drops {{items}} names nothing unknown, and is caught as well
  saveRow("translate", { system: seeded.system, user_template: "Translate these." });
  err = await send(VARS).catch((e) => e);
  expect(err?.fatal).toBe(true);
  expect(err.message).toContain("{{items}}");
  expect(wired.calls, "the engine was never called with a broken prompt").toEqual([]);
});

test("probe_guard_reads_the_resolved_preset_including_a_user_edit", () => {
  // Seeded: 0.2 → the probe may run.
  expect(presetTemperature("translate")).toBe(0.2);
  requireProbeTemperature("translate"); // no throw

  // A user pins temperature 0 in the Lab. The guard must SEE that — a guard on the constant
  // would wave through exactly the meaningless all-clear it exists to refuse.
  const preset = translatePreset();
  preset.temperature = 0.0;
  stores.getEnginePresetStore().save(preset);
  expect(() => requireProbeTemperature("translate")).toThrow(EngineNotConfigured);
  expect(() => requireProbeTemperature("translate")).toThrow(/temperature/);
});

test("the_probe_guard_and_the_run_read_the_same_preset", async () => {
  // The guard resolves the FEATURE's preset, runAction the ACTION's: they agree because each row's key is its
  // feature. Point translate at another preset: both move together.
  for (const [key, row] of Object.entries(DEFAULT_FEATURE_PROMPTS)) expect(row.feature, key).toBe(key);
  const other = { ...translatePreset(), id: "p_other", name: "Other", temperature: 0.6, builtIn: false };
  stores.getEnginePresetStore().save(other);
  stores.getFeaturePresetRefStore().set("translate", "p_other");
  expect(presetTemperature("translate")).toBe(0.6);
  await makeSend("translate")(VARS);
  expect(wired.calls.at(-1).temperature).toBe(0.6);
});

test("resolution_is_per_call_so_a_mid_run_preset_edit_lands", async () => {
  const send = makeSend("translate");
  await send(VARS);
  // Edit the preset between batches — the NEXT call must pick it up.
  const preset = translatePreset();
  preset.temperature = 0.5;
  stores.getEnginePresetStore().save(preset);
  await send(VARS);
  expect(wired.calls.map((c) => c.temperature)).toEqual([0.2, 0.5]);
});

test("the_whole_preset_reaches_the_adapter_not_just_temperature", async () => {
  // FOUND BY THE OVERNIGHT RE-REVIEW (2026-08-02): temperature and think reached the adapter
  // while topP, the long-tail samplers and reasoningEffort were silently dropped — a user
  // tuning topP in the Lab changed NOTHING here. The kit's runAction carries them now.
  const preset = translatePreset();
  preset.topP = 0.9;
  preset.samplers = [
    { flagName: "min_p", flagValue: "0.05" },
    { flagName: "repeat_penalty", flagValue: "1.05" },
  ];
  stores.getEnginePresetStore().save(preset);

  await makeSend("translate")(VARS);
  const extra = wired.calls.at(-1).extra;
  expect(Number(extra.top_p)).toBe(0.9);
  expect(Number(extra.min_p), "sampler values are TYPED, not strings").toBe(0.05);
  expect(Number(extra.repeat_penalty)).toBe(1.05);
  expect("response_format" in extra, "the schema still rides along").toBe(true);
  // think is OFF on this preset → no reasoning key (its PRESENCE means think-on).
  expect("reasoning_effort" in extra).toBe(false);
});

test("escalation_runs_the_chosen_preset_whole", async () => {
  // The escalate door (POST /v1/jobs presetId, the CLI's escalate): that preset's every tunable, none of the
  // feature's assigned one mixed in (the kit's RunRequest presetId).
  const translate = translatePreset();
  translate.topP = 0.9;
  stores.getEnginePresetStore().save(translate);
  stores.getEnginePresetStore().save({ ...translate, id: "p_strong", name: "Strong", temperature: 0.7, topP: null, builtIn: false });
  await makeSend("translate", "p_strong")(VARS);
  const call = wired.calls.at(-1);
  expect(call.temperature).toBe(0.7);
  expect("top_p" in call.extra, "the assigned preset's top_p is not mixed in").toBe(false);
  expect(() => makeSend("translate", "p_gone")).toThrow(/no engine preset/);
});

test("the_built_in_engine_refusing_its_model_ends_the_run", async () => {
  // the kit's localNotReady refusals (not installed, just stopped, a load that failed): no retry fixes them, and
  // each retry would load the model again
  setEnsureLocalModel(async () => {
    throw Object.assign(new Error("the AI engine isn't installed"), { localNotReady: true });
  });
  const err = await makeSend("translate")(VARS).catch((e) => e);
  expect(err).toBeInstanceOf(EngineNotConfigured);
  expect(err.fatal).toBe(true);
  expect(err.message).toContain("isn't installed");
});

test("the_built_in_engine_loads_the_preset_model_before_the_call", async () => {
  // Found 2026-10-15: a job on an unloaded model failed every key at once ("the bundled llama.cpp
  // engine isn't running"). The run makes the preset's model resident first — the kit's runAction
  // does it, through the same dispatch hook.
  const order = [];
  setEnsureLocalModel(async (mid) => order.push(`ensure ${mid}`));
  const chat = wired.chat.bind(wired);
  wired.chat = async (...args) => {
    order.push("chat");
    return chat(...args);
  };
  try {
    const preset = translatePreset();
    preset.model = "gemma-4-26b-a4b-qat-xl";
    stores.getEnginePresetStore().save(preset);
    await makeSend("translate")(VARS);
    expect(order).toEqual(["ensure gemma-4-26b-a4b-qat-xl", "chat"]);
  } finally {
    setEnsureLocalModel(null);
  }
});
