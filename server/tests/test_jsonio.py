# SPDX-License-Identifier: MIT
"""flatten/rebuild — the locale walk all three layers share."""

from __future__ import annotations

from just_ai_i18n_docgen.jsonio import flatten, rebuild


def test_flatten_makes_dotted_paths():
    assert flatten({"a": {"b": "x", "c": {"d": "y"}}, "e": "z"}) == {
        "a.b": "x", "a.c.d": "y", "e": "z",
    }


def test_rebuild_keeps_source_shape_and_drops_missing_keys():
    source = {"a": {"b": "B", "c": "C"}, "d": "D"}
    out = rebuild(source, {"a.b": "b!", "d": "d!"})
    # a.c failed to translate → ABSENT, not silently English; checks then report `missing`.
    assert out == {"a": {"b": "b!"}, "d": "d!"}


def test_rebuild_drops_an_entire_empty_branch():
    assert rebuild({"a": {"b": "B"}}, {}) == {}
