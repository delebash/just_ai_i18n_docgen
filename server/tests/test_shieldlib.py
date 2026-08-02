# SPDX-License-Identifier: MIT
"""The loop's pure parts, tested without a model: shielding, restore, the prompt, the
cache key. Ported from just-ai-help's `test/loop.test.js` — MINUS the buildRequest/
effectiveTemperature cases, deliberately: the request body belongs to llm-runner's
dispatch now, and per-request temperature belongs to the engine preset each feature
points at. When the loop ports, the probe's non-zero-temperature guard reads the
RESOLVED PRESET — a test for that lands with the loop."""

from __future__ import annotations

import json
import re

from just_ai_i18n_docgen.jsonio import placeholder_re
from just_ai_i18n_docgen.shieldlib import (
    build_system_prompt,
    build_user_message,
    cache_key,
    parse_items,
    restore,
    shield,
)

RE = placeholder_re({"prefix": "{", "suffix": "}"})


def test_shield_swaps_interpolations_and_restore_puts_them_back():
    src = 'Its {n} chapter will move to "{into}". | Its {n} chapters will move to "{into}".'
    shielded, tokens = shield(src, RE)
    assert shielded == 'Its ⟦0⟧ chapter will move to "⟦1⟧". | Its ⟦2⟧ chapters will move to "⟦3⟧".'
    assert tokens == ["{n}", "{into}", "{n}", "{into}"]
    assert restore(shielded, tokens) == src


def test_restore_returns_none_when_a_token_is_lost_duplicated_or_invented():
    _, tokens = shield("a {x} b {y}", RE)
    assert restore("solo ⟦0⟧", tokens) is None, "lost a token"
    assert restore("⟦0⟧⟦0⟧⟦1⟧", tokens) is None, "duplicated a token"
    assert restore("⟦0⟧⟦1⟧⟦9⟧", tokens) is None, "invented a token"


def test_restore_tolerates_a_model_adding_spaces_inside_the_brackets():
    _, tokens = shield("a {x}", RE)
    assert restore("hola ⟦ 0 ⟧", tokens) == "hola {x}"


def test_glossary_terms_are_shielded_too_the_measured_strands_hilos_failure():
    shielded, tokens = shield("Open JustWrite Strands", RE, ["JustWrite", "Strands"])
    assert shielded == "Open ⟦0⟧ ⟦1⟧"
    assert restore(shielded, tokens) == "Open JustWrite Strands"


def test_a_glossary_term_inside_a_longer_word_is_left_alone():
    shielded, _ = shield("Strandsville and Strands", RE, ["Strands"])
    assert shielded == "Strandsville and ⟦0⟧"


def test_longer_glossary_terms_win_over_shorter_ones_they_contain():
    shielded, tokens = shield("Ask the book now", RE, ["Ask", "Ask the book"])
    assert shielded == "⟦0⟧ now"
    assert restore(shielded, tokens) == "Ask the book now"


def test_the_prompt_carries_every_rule_and_drops_the_empty_slots():
    full = build_system_prompt(
        source="en",
        target_lang="es",
        do_not_translate=["JustWrite"],
        conventions_line="Spanish opens questions with ¿",
        plural_separator="|",
    )
    assert "en→es" in full
    assert "untouchable placeholders" in full
    assert "never translate these terms: JustWrite" in full
    assert "Spanish opens questions with ¿" in full
    assert "plural forms" in full

    bare = build_system_prompt(source="en", target_lang="fr")
    assert "never translate these terms" not in bare
    assert "; ;" not in bare, "an empty slot must not leave a dangling separator"


def test_bites_the_plural_rule_is_built_from_the_configured_separator():
    # This rule was the literal `" | "` for the whole life of the Node tool, which made
    # pluralSeparator a half-honoured setting: the checks split on YOUR value while the
    # model was told about a pipe.
    semi = build_system_prompt(source="en", target_lang="de", plural_separator=";;")
    assert '";;"' in semi, "the prompt must name the separator the checks will enforce"
    assert '" | "' not in semi, "the old hardcoded pipe must be gone"


def test_bites_a_catalogue_with_no_plural_forms_is_not_told_about_a_separator():
    # i18next keeps plurals as separate keys, so a None separator is legitimate — telling
    # the model that some character marks plural forms is then simply a false instruction.
    none = build_system_prompt(source="en", target_lang="ja", plural_separator=None)
    assert "plural forms" not in none
    assert "; ;" not in none


def test_the_cache_key_changes_when_anything_that_could_change_the_answer_changes():
    base = {"text": "Save", "lang": "es", "context_hash": "c", "glossary_hash": "g"}
    k = cache_key(**base)
    assert cache_key(**{**base, "text": "Save now"}) != k
    assert cache_key(**{**base, "lang": "fr"}) != k
    assert cache_key(**{**base, "context_hash": "c2"}) != k, "a changed context must re-translate"
    assert cache_key(**{**base, "glossary_hash": "g2"}) != k, "a changed glossary must re-translate"
    assert cache_key(**base) == k, "and it is stable"


# ── Per-key notes ────────────────────────────────────────────────────────────────────
# The feedback loop that closes the review workspace: a note written while fixing a key
# is sent WITH that key next time, so the same defect does not have to be found twice.
# This exists because cfg["context"] is one sentence for the whole catalogue — that is
# how "Why:" (a label above a reasoning block) came back as "¿Por qué?".


def test_a_note_is_attached_to_its_key_and_to_no_other():
    msg = build_user_message(
        [
            {"i": 0, "key": "characterAudit.why", "shielded": "Why:"},
            {"i": 1, "key": "settings.save", "shielded": "Save"},
        ],
        {"context": "an app", "notes": {"characterAudit.why": "a label above the reasoning, not a question"}},
    )
    items = json.loads(re.search(r"Translate items: (\[.*\])$", msg, re.DOTALL).group(1))
    assert items[0]["note"] == "a label above the reasoning, not a question"
    assert "note" not in items[1], "an un-noted key must not carry one"


def test_no_notes_at_all_changes_nothing_about_the_message():
    shielded = [{"i": 0, "key": "a", "shielded": "Save"}]
    assert build_user_message(shielded, {"context": "an app"}) == build_user_message(
        shielded, {"context": "an app", "notes": {}}
    )


def test_the_system_prompt_tells_the_model_what_a_note_is():
    p = build_system_prompt(source="en", target_lang="es")
    assert "note" in p, "a field the model is never told about is a field it ignores"


def test_parse_items_reads_clean_json_and_salvages_a_fenced_reply():
    clean = json.dumps({"items": [{"id": 0, "translation": "Hola"}]})
    assert parse_items(clean) == {0: "Hola"}
    fenced = f"```json\n{clean}\n```"
    assert parse_items(fenced) == {0: "Hola"}
