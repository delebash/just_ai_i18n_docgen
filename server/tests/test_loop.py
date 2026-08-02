# SPDX-License-Identifier: MIT
"""The loop's orchestration, driven through a fake `send` — no model anywhere. The
behaviours under test are the paid-for ones: the delta skip, the retry ladder ending in
singletons, keys NEVER silently skipped, the per-batch flush that makes an interrupted
hour resumable, and cancellation that only ever stops on a batch boundary."""

from __future__ import annotations

import json
import re

from just_ai_i18n_docgen.loop import translate_language

CFG = {
    "placeholder": {"prefix": "{", "suffix": "}"},
    "pluralSeparator": "|",
    "sourceLanguage": "en",
    "context": "a test app",
    "glossary": {"doNotTranslate": []},
}


def echo_send(system: str, user: str) -> str:
    """A well-behaved engine: returns every item 'translated' with shields intact."""
    items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.S).group(1))
    return json.dumps({"items": [
        {"id": it["id"], "translation": f"XX {it['text']}"} for it in items
    ]})


def test_happy_path_translates_writes_cache_and_reports_counts(tmp_path):
    cache = tmp_path / "cache.json"
    logs = []
    result = translate_language(
        source_flat={"a": "Hello {name}", "b": "Save"},
        lang="es", cfg=CFG, cache_path=cache, send=echo_send, log=logs.append,
    )
    assert result["values"] == {"a": "XX Hello {name}", "b": "XX Save"}
    assert result["failed"] == [] and result["requests"] == 1
    assert json.loads(cache.read_text(encoding="utf-8")), "the cache was flushed"
    assert any("0 unchanged, 2 to translate" in line for line in logs)


def test_the_delta_skips_only_when_target_exists_and_cache_agrees(tmp_path):
    cache = tmp_path / "cache.json"
    first = translate_language(
        source_flat={"a": "Hello"}, lang="es", cfg=CFG, cache_path=cache, send=echo_send,
        log=lambda _s: None,
    )
    # Second run with the existing target + warm cache: no engine call at all.
    calls = []

    def counting_send(system, user):
        calls.append(1)
        return echo_send(system, user)

    second = translate_language(
        source_flat={"a": "Hello"}, existing_flat=first["values"],
        lang="es", cfg=CFG, cache_path=cache, send=counting_send, log=lambda _s: None,
    )
    assert second["requests"] == 0 and calls == []
    assert second["values"] == first["values"], "the existing translation is kept verbatim"

    # Changed SOURCE text -> new cache key -> re-translated even though a target exists.
    third = translate_language(
        source_flat={"a": "Hello there"}, existing_flat=first["values"],
        lang="es", cfg=CFG, cache_path=cache, send=counting_send, log=lambda _s: None,
    )
    assert third["requests"] == 1


def test_a_lost_shield_token_is_a_failure_routed_to_retry_not_a_result(tmp_path):
    attempts = []

    def flaky_send(system, user):
        items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.S).group(1))
        attempts.append(len(items))
        if len(attempts) == 1:
            # First reply loses the shield token on every item — must not be accepted.
            return json.dumps({"items": [
                {"id": it["id"], "translation": "sin token"} for it in items
            ]})
        return echo_send(system, user)

    result = translate_language(
        source_flat={"a": "Hi {n}"}, lang="es", cfg=CFG,
        cache_path=tmp_path / "c.json", send=flaky_send, log=lambda _s: None,
    )
    assert result["values"]["a"] == "XX Hi {n}", "the retry recovered the key"
    assert result["requests"] >= 2


def test_a_key_that_exhausts_every_retry_is_reported_never_silently_skipped(tmp_path):
    def always_bad(system, user):
        items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.S).group(1))
        return json.dumps({"items": [
            {"id": it["id"], "translation": ""} for it in items
        ]})

    result = translate_language(
        source_flat={"a": "Hello", "b": "Bye"}, lang="es", cfg=CFG,
        cache_path=tmp_path / "c.json", send=always_bad, log=lambda _s: None,
    )
    # THE rule this project exists for: failed keys are NAMED, values do not contain them.
    assert sorted(result["failed"]) == ["a", "b"]
    assert result["values"] == {}


def test_singletons_isolate_one_pathological_string(tmp_path):
    def poison_b(system, user):
        items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.S).group(1))
        out = []
        for it in items:
            if "Bye" in it["text"]:
                out.append({"id": it["id"], "translation": ""})  # b always fails
            else:
                out.append({"id": it["id"], "translation": f"XX {it['text']}"})
        return json.dumps({"items": out})

    result = translate_language(
        source_flat={"a": "Hello", "b": "Bye"}, lang="es", cfg=CFG,
        cache_path=tmp_path / "c.json", send=poison_b, log=lambda _s: None,
    )
    assert result["values"] == {"a": "XX Hello"}, "the good key is delivered"
    assert result["failed"] == ["b"], "the bad one is isolated and named"


def test_on_batch_flushes_after_every_batch_so_a_crash_resumes(tmp_path):
    flushes = []
    translate_language(
        source_flat={f"k{i}": f"word {i}" for i in range(4)},
        lang="es", cfg=CFG, cache_path=tmp_path / "c.json", send=echo_send,
        batch_size=2, on_batch=lambda values: flushes.append(len(values)),
        log=lambda _s: None,
    )
    assert flushes == [2, 4], "partial progress is written after EACH batch, not once at the end"


def test_cancellation_stops_on_a_batch_boundary_with_consistent_state(tmp_path):
    seen = {"batches": 0}

    def send_and_count(system, user):
        seen["batches"] += 1
        return echo_send(system, user)

    result = translate_language(
        source_flat={f"k{i}": f"word {i}" for i in range(4)},
        lang="es", cfg=CFG, cache_path=tmp_path / "c.json", send=send_and_count,
        batch_size=2, is_cancelled=lambda: seen["batches"] >= 1,
        log=lambda _s: None,
    )
    assert result["cancelled"] is True
    assert len(result["values"]) == 2, "the paid-for batch is kept, the next never started"


def test_force_retranslates_but_never_wipes_other_cache_entries(tmp_path):
    cache = tmp_path / "c.json"
    translate_language(
        source_flat={"a": "Hello", "b": "Bye"}, lang="es", cfg=CFG,
        cache_path=cache, send=echo_send, log=lambda _s: None,
    )
    entries_before = len(json.loads(cache.read_text(encoding="utf-8")))
    # Force ONE key: the other's cache entry must survive — force means "re-translate
    # these anyway", not "throw away what every other key already learned".
    translate_language(
        source_flat={"a": "Hello"}, lang="es", cfg=CFG,
        cache_path=cache, send=echo_send, force=True, log=lambda _s: None,
    )
    assert len(json.loads(cache.read_text(encoding="utf-8"))) == entries_before
