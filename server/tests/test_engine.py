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


def test_structured_output_forks_per_provider_family():
    # The same fork the Node buildRequest had: Ollama native takes `format`,
    # every OpenAI-shaped endpoint takes `response_format`.
    assert "format" in structured_extra("ollama")
    assert "response_format" not in structured_extra("ollama")
    for t in ("local-llamacpp", "openai-compat", "openai", "gemini"):
        assert "response_format" in structured_extra(t), t


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
