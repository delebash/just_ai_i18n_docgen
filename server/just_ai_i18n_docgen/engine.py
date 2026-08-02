# SPDX-License-Identifier: MIT
"""The engine seam — where the loop's `send` meets the shared LLM stack.

The Node tool owned its whole transport (`buildRequest`/`callModel`) because owning the
request body was the only cure for invisible request damage. In this rewrite the body is
owned by llm-runner's adapters — `extra` routes per-provider exactly the way `extraBody`
did, and every knob the old engines.json carried lives in the ENGINE PRESET the feature
points at (one-source: the preset owns provider+model+temperature/think/samplers).

So this module is deliberately thin: resolve the feature's preset, fetch the adapter,
shape ONE call. It exists as a seam so the loop stays testable without a model and the
resolution logic has one home — the Node repo's rule "ONE engine resolver, used by both
doors" survives translation.

THE PROBE GUARD LIVES HERE, reading the RESOLVED PRESET. The Node version refused
`--probe` at effective temperature 0 by reading the BUILT request body, because a second
copy of the merge rules would drift. The preset is now the one source the body is built
from, so the guard reads it — same principle, new single source.
"""

from __future__ import annotations

from collections.abc import Callable

from llm_runner.llm import LLMMessage, get_llm_registry
from llm_runner.llm.preset_resolve import resolve_feature_preset

from .shieldlib import RESPONSE_SCHEMA


class EngineNotConfigured(RuntimeError):
    """Raised when a feature resolves to no usable preset/adapter — loudly, with the
    fix in the message, never a silent fallback to some other engine."""


def resolve_engine(feature: str = "translate", preset_id: str | None = None):
    """(adapter, preset) for a feature, or a loud failure naming what is missing.

    `preset_id` is the ESCALATION door: re-doing flagged keys with a stronger engine
    means pointing at a specific preset rather than the feature's assigned one — the
    old `--escalate <profile>` became "escalate to a preset", same one-resolver rule."""
    if preset_id:
        from llm_runner.llm import stores

        preset = next((p for p in stores.get_engine_preset_store().list()
                       if p.id == preset_id), None)
        if preset is None:
            raise EngineNotConfigured(
                f'no engine preset with id "{preset_id}" — list them on the AI-features page.'
            )
    else:
        preset = resolve_feature_preset(feature)
    if preset is None:
        raise EngineNotConfigured(
            f'feature "{feature}" resolves to no engine preset — assign one on the '
            "AI-features page (or check the seeded default_preset_id)."
        )
    adapter = get_llm_registry().get(preset.providerId)
    if adapter is None:
        raise EngineNotConfigured(
            f'preset "{preset.name}" points at provider "{preset.providerId}", which is '
            "not registered — configure the provider (Settings → AI) or point the preset "
            "at one that exists."
        )
    return adapter, preset


def structured_extra(provider_type: str) -> dict:
    """The structured-output knob, shaped per provider family — the same fork the Node
    `buildRequest` had, now expressed as ONE `extra` dict the shared adapter routes:
    Ollama's native endpoint takes the schema in `format`; every OpenAI-shaped endpoint
    (llama-server, cloud compat) takes `response_format.json_schema`."""
    if provider_type == "ollama":
        return {"format": RESPONSE_SCHEMA}
    return {
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "translations", "strict": True, "schema": RESPONSE_SCHEMA},
        }
    }


def make_send(feature: str = "translate", preset_id: str | None = None) -> Callable[[str, str], str]:
    """The loop's `send(system, user) -> str`, built from the resolved preset.

    Resolution happens PER CALL, not at closure build: a preset edited mid-run (or a
    provider re-registered) is picked up on the next batch, and the closure holds no
    stale adapter reference across an hour-long catalogue."""

    def send(system: str, user: str) -> str:
        adapter, preset = resolve_engine(feature, preset_id)
        response = adapter.chat(
            [LLMMessage(role="user", content=user)],
            model=preset.model or None,
            temperature=preset.temperature,
            max_tokens=preset.maxTokens or None,
            system=system,
            think=preset.think,
            extra=structured_extra(adapter.provider_type),
        )
        text = response.text
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError(
                "Empty content from the engine. A thinking model with no output budget "
                "does this — check the preset's think toggle."
            )
        return text

    return send


def preset_temperature(feature: str = "translate") -> float | None:
    """The temperature the resolved preset will send. None means the provider's own
    default applies (non-zero for every shipped provider)."""
    _, preset = resolve_engine(feature)
    return preset.temperature


def require_probe_temperature(feature: str = "translate") -> None:
    """Refuse rather than mislead: the probe measures the engine's uncertainty by
    sampling it twice, and at temperature 0 the two passes are identical by
    construction — the result would be a meaningless all-clear. Guarded on the RESOLVED
    preset, the one source the request is built from."""
    t = preset_temperature(feature)
    if t == 0:
        raise EngineNotConfigured(
            "the probe needs a non-zero sampling temperature: it compares two samples of "
            "the same engine, and at temperature 0 they are identical by construction, so "
            f'the result would be a meaningless all-clear. The "{feature}" preset\'s '
            "temperature is 0 — raise it in the preset, or drop the probe."
        )
