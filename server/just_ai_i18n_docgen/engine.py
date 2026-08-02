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


def structured_extra(provider_type: str = "") -> dict:
    """The structured-output knob — ONE shape for every provider: OpenAI-style
    `response_format.json_schema`. The ADAPTERS own the per-provider translation
    (Ollama's converts it to its native `format` field itself).

    This function used to fork per provider like the Node `buildRequest` did — and the
    live E2E (2026-08-02) proved that wrong in one run: the hand-built raw `format` key
    fell into the Ollama adapter's sampling-params branch, landed inside `options`
    where Ollama ignores it, and the model freestyled non-schema JSON — 15 requests, 6
    keys exhausted, exit 1 (correctly loud). The fork was not just unnecessary, it
    DEFEATED the adapter's own routing. `provider_type` is kept for signature
    stability and deliberately unused."""
    del provider_type
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
            extra={**structured_extra(adapter.provider_type), **preset_extra(preset)},
        )
        text = response.text
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError(
                "Empty content from the engine. A thinking model with no output budget "
                "does this — check the preset's think toggle."
            )
        return text

    return send


def _parse_sampler_value(v: str):
    """A stored text sampler value → the JSON type the chat API expects (bool / int /
    float / str). Empty → None. Faithful to the shared run path's parser
    (llm_runner.llm.prompts._parse_sampler_value) — private there, so ported rather
    than imported; the overnight re-review (2026-08-02) is when the whole overlay was
    found missing here."""
    s = (v or "").strip()
    if not s:
        return None
    low = s.lower()
    if low in ("true", "false"):
        return low == "true"
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


def preset_extra(preset) -> dict:
    """The preset's remaining tunables as adapter `extra` — top_p, the long-tail
    samplers, and the reasoning level, mirroring the shared run path's overlay
    (prompts._plane2_extra). FOUND MISSING by the overnight re-review: temperature and
    think reached the adapter while topP/samplers/reasoningEffort were silently
    dropped — a user tuning topP in the Lab changed nothing here. A half-honoured
    setting is this family's most-hated bug class; now every preset field lands."""
    extra: dict = {}
    top_p = getattr(preset, "topP", None)
    if top_p is not None:
        extra["top_p"] = top_p
    for row in getattr(preset, "samplers", None) or []:
        name = (getattr(row, "flagName", "") or "").strip()
        if name and name not in extra:
            val = _parse_sampler_value(getattr(row, "flagValue", "") or "")
            if val is not None:
                extra[name] = val
    # The reserved key's PRESENCE marks think-on for the adapters' reasoning mapping;
    # "" is a real state (FOLLOW the model's layered budget). Only under think.
    if getattr(preset, "think", False):
        extra["reasoning_effort"] = getattr(preset, "reasoningEffort", "") or ""
    # The sampler ORDER is an array of names; accept the comma-joined knob string.
    if isinstance(extra.get("samplers"), str):
        extra["samplers"] = [s.strip() for s in extra["samplers"].split(",") if s.strip()]
    return extra


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
