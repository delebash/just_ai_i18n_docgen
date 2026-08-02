# SPDX-License-Identifier: MIT
"""Inference from the source catalogue — ported from just-ai-help's infer behaviour:
an explicit config value always wins, an inferred one is REPORTED, and None is a real
answer for a catalogue with no plural forms."""

from __future__ import annotations

from just_ai_i18n_docgen.infer import (
    infer_config,
    infer_placeholder,
    infer_plural_separator,
)


def test_placeholder_inference_counts_matches_and_double_braces_beat_single():
    assert infer_placeholder(["Hello {name}", "Save {n}"]) == {"prefix": "{", "suffix": "}"}
    assert infer_placeholder(["Hello {{name}}", "Save {{n}}"]) == {"prefix": "{{", "suffix": "}}"}
    # One literal {{ in prose must not flip a vue-i18n catalogue to i18next.
    assert infer_placeholder(["{a}", "{b}", "{c}", "literal {{x}} once"]) == {
        "prefix": "{", "suffix": "}",
    }
    # Nothing at all → the most common default.
    assert infer_placeholder(["Save", "Open"]) == {"prefix": "{", "suffix": "}"}


def test_plural_separator_none_is_a_real_answer():
    assert infer_plural_separator(["{n} note | {n} notes"]) == " | "
    assert infer_plural_separator(["Save", "Open"]) is None
    # A pipe inside prose with an empty half is not a separator.
    assert infer_plural_separator(["a | "]) is None


def test_infer_config_reports_what_it_guessed_and_explicit_values_win():
    cfg, inferred = infer_config({}, {"a": "Hi {n}", "b": "{n} x | {n} y"})
    assert cfg["placeholder"] == {"prefix": "{", "suffix": "}"}
    assert cfg["pluralSeparator"] == " | "
    assert len(inferred) == 2, "both guesses are SAID, never silent"

    explicit = {"placeholder": {"prefix": "%{", "suffix": "}"}, "pluralSeparator": None}
    cfg2, inferred2 = infer_config(explicit, {"a": "Hi {n}"})
    assert cfg2["placeholder"] == {"prefix": "%{", "suffix": "}"}, "explicit wins"
    assert cfg2["pluralSeparator"] is None, "an explicit None is respected, not re-inferred"
    assert inferred2 == []


def test_a_bare_glossary_array_is_normalised():
    cfg, _ = infer_config({"glossary": ["JustWrite"]}, {"a": "x"})
    assert cfg["glossary"] == {"doNotTranslate": ["JustWrite"]}
