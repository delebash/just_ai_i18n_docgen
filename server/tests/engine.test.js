// SPDX-License-Identifier: MIT
// Port of tests/test_engine.py — the engine seam: resolution through the REAL seeded stores,
// one fake adapter.
//
// What must hold: the seeded "translate" preset (temperature 0.2, the measured constant)
// reaches the adapter call verbatim; the structured-output knob is one shape for every
// provider; failure is loud and names the fix; and the probe guard reads the RESOLVED preset —
// including a user's edit — never a constant.
import { LLMResponse } from "@delebash/llm-runner/llm";
import { getLlmRegistry } from "@delebash/llm-runner/llm/registry";
import * as stores from "@delebash/llm-runner/llm/stores";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, seedLlmStack } from "../src/app.js";
import {
  EngineNotConfigured,
  makeSend,
  presetTemperature,
  requireProbeTemperature,
  structuredExtra,
} from "../src/engine.js";
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

// The real app (seeded presets, real stores) + a fake adapter in the real registry.
let wired;
let saved;
beforeEach(async () => {
  await createApp(tmpDir()); // boots; the client itself is not needed
  seedLlmStack(); // the serve-time seed, explicit
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

test("send_carries_the_seeded_preset_to_the_adapter", async () => {
  const send = makeSend("translate");
  const out = await send("SYSTEM PROMPT", "USER MESSAGE");
  expect(JSON.parse(out).items[0].translation).toBe("Hola");

  const call = wired.calls[0];
  expect(call.system).toBe("SYSTEM PROMPT");
  expect(call.messages[0].content).toBe("USER MESSAGE");
  // The MEASURED constant, delivered from the SEEDED preset — one source, no drift.
  expect(call.temperature).toBe(0.2);
  expect(call.think).toBe(false);
  expect(call.model, 'preset model "" means the provider default, sent as null').toBeNull();
  // llama-server is OpenAI-shaped → response_format, not Ollama's format key.
  expect("response_format" in call.extra).toBe(true);
  expect(call.extra.response_format.json_schema.schema.required).toEqual(["items"]);
});

test("structured_output_is_one_shape_the_adapters_translate", () => {
  // ONE OpenAI-style response_format for every provider — the adapters own the per-provider
  // translation (Ollama's converts it to `format` itself). The old per-provider fork here put
  // a raw `format` key into the adapter's sampling-params branch, where Ollama ignored it —
  // found LIVE by the first real E2E run: 6 of 6 keys exhausted every retry.
  for (const t of ["ollama", "local-llamacpp", "openai-compat", "openai", "gemini"]) {
    const extra = structuredExtra(t);
    expect("response_format" in extra, t).toBe(true);
    expect("format" in extra, t).toBe(false);
    expect(extra.response_format.json_schema.schema.required).toEqual(["items"]);
  }
});

test("empty_engine_reply_fails_loudly_naming_the_think_toggle", async () => {
  wired.chat = async () => LLMResponse({ text: "", model: "m" });
  await expect(makeSend("translate")("S", "U")).rejects.toThrow(/think/);
});

test("missing_provider_fails_loudly_naming_the_fix", async () => {
  getLlmRegistry()._adapters.delete("local-llamacpp");
  const err = await makeSend("translate")("S", "U").catch((e) => e);
  expect(err).toBeInstanceOf(EngineNotConfigured);
  expect(err.message).toMatch(/not registered/);
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

test("resolution_is_per_call_so_a_mid_run_preset_edit_lands", async () => {
  const send = makeSend("translate");
  await send("S", "U");
  // Edit the preset between batches — the NEXT call must pick it up.
  const preset = translatePreset();
  preset.temperature = 0.5;
  stores.getEnginePresetStore().save(preset);
  await send("S", "U");
  expect(wired.calls.map((c) => c.temperature)).toEqual([0.2, 0.5]);
});

test("the_whole_preset_reaches_the_adapter_not_just_temperature", async () => {
  // FOUND BY THE OVERNIGHT RE-REVIEW (2026-08-02): temperature and think reached the adapter
  // while topP, the long-tail samplers and reasoningEffort were silently dropped — a user
  // tuning topP in the Lab changed NOTHING here. This asserts every preset field lands,
  // mirroring the kit's prompts._plane2Extra.
  const preset = translatePreset();
  preset.topP = 0.9;
  preset.samplers = [
    { flagName: "min_p", flagValue: "0.05" },
    { flagName: "repeat_penalty", flagValue: "1.05" },
  ];
  stores.getEnginePresetStore().save(preset);

  await makeSend("translate")("S", "U");
  const extra = wired.calls[wired.calls.length - 1].extra;
  expect(extra.top_p).toBe(0.9);
  expect(extra.min_p, "sampler values are TYPED, not strings").toBe(0.05);
  expect(extra.repeat_penalty).toBe(1.05);
  expect("response_format" in extra, "the schema still rides along").toBe(true);
  // think is OFF on this preset → no reasoning key (its PRESENCE means think-on).
  expect("reasoning_effort" in extra).toBe(false);
});
