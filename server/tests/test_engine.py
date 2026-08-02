# SPDX-License-Identifier: MIT
"""The engine seam — resolution through the REAL seeded stores, one fake adapter.

What must hold: the seeded "translate" preset (temperature 0.2, the measured constant)
reaches the adapter call verbatim; the structured-output knob forks per provider family
exactly as the Node buildRequest did; failure is loud and names the fix; and the probe
guard reads the RESOLVED preset — including a user's edit — never a constant."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from llm_runner.llm import LLMResponse, get_llm_registry, seed, stores
from llm_runner.runner import lifecycle

from just_ai_i18n_docgen.app import create_app
from just_ai_i18n_docgen.engine import (
    EngineNotConfigured,
    make_send,
    preset_temperature,
    require_probe_temperature,
    structured_extra,
)


class FakeAdapter:
    provider_id = "local-llamacpp"  # the id the seeded presets point at
    provider_type = "local-llamacpp"
    default_model = "fake-default"

    def __init__(self):
        self.calls = []

    def chat(self, messages, *, model=None, temperature=0.7, max_tokens=None,
             system=None, think=False, extra=None, **kwargs):
        self.calls.append({
            "messages": messages, "model": model, "temperature": temperature,
            "max_tokens": max_tokens, "system": system, "think": think, "extra": extra,
        })
        return LLMResponse(text=json.dumps({"items": [{"id": 0, "translation": "Hola"}]}),
                           model=model or self.default_model)


@pytest.fixture
def wired(tmp_path, monkeypatch):
    """The real app (seeded presets, real stores) + a fake adapter in the real registry."""
    monkeypatch.setattr(lifecycle, "_service", None)
    monkeypatch.setattr(seed, "_APP", dict(seed._APP))
    TestClient(create_app(tmp_path))  # boots + seeds; the client itself is not needed
    reg = get_llm_registry()
    fake = FakeAdapter()
    saved = reg.get(fake.provider_id)
    reg.register(fake)
    yield fake
    if saved is not None:
        reg.register(saved)
    else:
        reg._adapters.pop(fake.provider_id, None)


def test_send_carries_the_seeded_preset_to_the_adapter(wired):
    send = make_send("translate")
    out = send("SYSTEM PROMPT", "USER MESSAGE")
    assert json.loads(out)["items"][0]["translation"] == "Hola"

    call = wired.calls[0]
    assert call["system"] == "SYSTEM PROMPT"
    assert call["messages"][0].content == "USER MESSAGE"
    # The MEASURED constant, delivered from the SEEDED preset — one source, no drift.
    assert call["temperature"] == 0.2
    assert call["think"] is False
    assert call["model"] is None, 'preset model "" means the provider default, sent as None'
    # llama-server is OpenAI-shaped → response_format, not Ollama's format key.
    assert "response_format" in call["extra"]
    assert call["extra"]["response_format"]["json_schema"]["schema"]["required"] == ["items"]


def test_structured_output_is_one_shape_the_adapters_translate():
    # ONE OpenAI-style response_format for every provider — the adapters own the
    # per-provider translation (Ollama's converts it to `format` itself). The old
    # per-provider fork here put a raw `format` key into the adapter's sampling-params
    # branch, where it landed in `options` and Ollama ignored it — found LIVE by the
    # first real E2E run: 6 of 6 keys exhausted every retry.
    for t in ("ollama", "local-llamacpp", "openai-compat", "openai", "gemini"):
        extra = structured_extra(t)
        assert "response_format" in extra, t
        assert "format" not in extra, t
        assert extra["response_format"]["json_schema"]["schema"]["required"] == ["items"]


def test_empty_engine_reply_fails_loudly_naming_the_think_toggle(wired):
    wired.chat = lambda *a, **k: LLMResponse(text="", model="m")
    with pytest.raises(RuntimeError, match="think"):
        make_send("translate")("S", "U")


def test_missing_provider_fails_loudly_naming_the_fix(wired):
    get_llm_registry()._adapters.pop("local-llamacpp", None)
    with pytest.raises(EngineNotConfigured, match="not registered"):
        make_send("translate")("S", "U")


def test_probe_guard_reads_the_resolved_preset_including_a_user_edit(wired):
    # Seeded: 0.2 → the probe may run.
    assert preset_temperature("translate") == 0.2
    require_probe_temperature("translate")  # no raise

    # A user pins temperature 0 in the Lab. The guard must SEE that — a guard on the
    # constant would wave through exactly the meaningless all-clear it exists to refuse.
    store = stores.get_engine_preset_store()
    preset = next(p for p in store.list() if p.id == "p_translate")
    preset.temperature = 0.0
    store.save(preset)
    with pytest.raises(EngineNotConfigured, match="temperature"):
        require_probe_temperature("translate")


def test_resolution_is_per_call_so_a_mid_run_preset_edit_lands(wired):
    send = make_send("translate")
    send("S", "U")
    # Edit the preset between batches — the NEXT call must pick it up.
    store = stores.get_engine_preset_store()
    preset = next(p for p in store.list() if p.id == "p_translate")
    preset.temperature = 0.5
    store.save(preset)
    send("S", "U")
    assert [c["temperature"] for c in wired.calls] == [0.2, 0.5]


def test_the_whole_preset_reaches_the_adapter_not_just_temperature(wired):
    """FOUND BY THE OVERNIGHT RE-REVIEW (2026-08-02): temperature and think reached the
    adapter while topP, the long-tail samplers and reasoningEffort were silently
    dropped — a user tuning topP in the Lab changed NOTHING here. A half-honoured
    setting is this family's most-hated bug class (pluralSeparator, JV's llm_roles…),
    so this asserts every preset field lands, mirroring prompts._plane2_extra."""
    from llm_runner.llm.presets_api import PresetFlagRow

    store = stores.get_engine_preset_store()
    preset = next(p for p in store.list() if p.id == "p_translate")
    preset.topP = 0.9
    preset.samplers = [PresetFlagRow(flagName="min_p", flagValue="0.05"),
                       PresetFlagRow(flagName="repeat_penalty", flagValue="1.05")]
    store.save(preset)

    make_send("translate")("S", "U")
    extra = wired.calls[-1]["extra"]
    assert extra["top_p"] == 0.9
    assert extra["min_p"] == 0.05, "sampler values are TYPED, not strings"
    assert extra["repeat_penalty"] == 1.05
    assert "response_format" in extra, "the schema still rides along"
    # think is OFF on this preset → no reasoning key (its PRESENCE means think-on).
    assert "reasoning_effort" not in extra
