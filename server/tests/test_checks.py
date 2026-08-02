# SPDX-License-Identifier: MIT
"""Every check gets TWO cases: a clean string it must stay silent about, and a
deliberately broken one it must complain about. The second is the point — a check that
has never been seen to fail is indistinguishable from a check that cannot fail, and this
project exists because a tool that always exited 0 looked exactly like a tool that
worked. Ported case-for-case from just-ai-help's `test/checks.test.js`; the broken
strings are the MEASURED defects from the 2026-07 runs, verbatim."""

from __future__ import annotations

import json
from pathlib import Path

from just_ai_i18n_docgen.checks import build_context, check_one, run_checks

CONVENTIONS = json.loads(
    (Path(__file__).parent.parent / "src/just_ai_i18n_docgen/config/conventions.json")
    .read_text(encoding="utf-8")
)

CFG = {
    "placeholder": {"prefix": "{", "suffix": "}"},
    "pluralSeparator": "|",
    "glossary": {"doNotTranslate": ["JustWrite", "Strands"]},
}
CTX = build_context(CFG, CONVENTIONS, "es")


def codes(src: str, dst: str) -> list[str]:
    return [f["code"] for f in check_one(key="k", src=src, dst=dst, ctx=CTX)]


def test_clean_translations_raise_nothing():
    assert codes("Delete {n} note?", "¿Eliminar {n} nota?") == []
    assert codes("{n} note | {n} notes", "{n} nota | {n} notas") == []
    assert codes("Open JustWrite", "Abrir JustWrite") == []
    assert codes("Save", "Guardar") == []


def test_placeholder_changed_bites_when_an_interpolation_is_rewritten():
    # The exact defect lingo.dev produced on the corpus, 2026-07-27.
    assert "placeholder-changed" in codes("{n} note | {n} notes", "{n} nota | {3} notas")
    assert "placeholder-changed" in codes("Move to {into}", "Mover a {dentro}")
    assert "placeholder-changed" in codes("Hello {name}", "Hola")


def test_plural_halves_lost_bites_when_a_form_disappears():
    assert "plural-halves-lost" in codes("{n} note | {n} notes", "{n} notas")


def test_plural_halves_identical_bites_the_one_nothing_else_catches():
    # Right separator, right placeholders, right word count, and still wrong.
    found = codes(
        "Delete {n} autosave? | Delete {n} autosaves?",
        "¿Eliminar {n} autoguardados? | ¿Eliminar {n} autoguardados?",
    )
    assert "plural-halves-identical" in found


def test_glossary_translated_bites_when_a_brand_name_is_translated():
    # "Strands" -> "Hilos", produced by both lingo.dev and one unshielded run, 2026-07-27.
    assert "glossary-translated" in codes("Strands", "Hilos")
    assert "glossary-translated" in codes("Open JustWrite now", "Abrir Escribir ahora")


def test_untranslated_bites_on_a_skipped_string_but_not_a_shielded_only_one():
    assert "untranslated" in codes("Chapters", "Chapters")
    # Shielded content is meant to come back unchanged. Flagging our own correct
    # behaviour would train people to ignore the report.
    assert codes("Strands", "Strands") == []
    assert codes("{count}", "{count}") == []


def test_startpunc_bites_on_the_missing_spanish_opening_mark():
    # Measured 5/5 failures on qwen3:8b and 5/5 on lingo.dev, rule in the prompt both times.
    assert "startpunc" in codes("Delete this chapter?", "Eliminar este capítulo?")
    assert "startpunc" in codes("Careful!", "Cuidado!")
    assert codes("Delete this chapter?", "¿Eliminar este capítulo?") == []


def test_spurious_interrogative_bites_when_the_model_invents_a_question():
    # The real regression, measured on the full 846-key catalogue: 72 ¿ against 16 real
    # questions. These are verbatim from that run.
    assert "spurious-interrogative" in codes("Try tutorial project", "¿Probar proyecto de tutorial?")
    assert "spurious-interrogative" in codes("Statuses", "¿Estados?")
    assert "spurious-interrogative" in codes("Careful", "¡Cuidado!")
    # A genuine question keeps its marks and stays silent — the cure must not undo startpunc.
    assert codes("Delete this chapter?", "¿Eliminar este capítulo?") == []
    assert codes("Careful!", "¡Cuidado!") == []


def test_startpunc_is_silent_for_a_language_with_no_conventions_row():
    # Shipping rules we do not know is worse than shipping none.
    fr_ctx = build_context(CFG, CONVENTIONS, "fr")
    assert check_one(key="k", src="Delete?", dst="Supprimer ?", ctx=fr_ctx) == []


def test_endpunc_bites_when_terminal_punctuation_is_dropped():
    assert "endpunc" in codes("Saved.", "Guardado")
    assert "endpunc" in codes("Ready", "¿Listo?")


def test_numbers_bites_when_a_quantity_changes():
    assert "numbers" in codes("Up to 500 words", "Hasta 50 palabras")
    assert codes("Up to 500 words", "Hasta 500 palabras") == []


def test_brackets_bites_when_a_wrapper_is_dropped():
    assert "brackets" in codes("Chapter (draft)", "Capítulo (borrador")
    assert "brackets" in codes("See [docs]", "Ver docs")


def test_blank_bites_on_a_whitespace_only_translation():
    assert "blank" in codes("Save", "   ")


def test_doublewords_bites_on_a_stutter():
    assert "doublewords" in codes("The book", "El el libro")
    assert codes("It is what it is", "Es lo que es") == []


def test_whitespace_bites_when_leading_or_trailing_spacing_changes():
    assert "whitespace" in codes("Save ", "Guardar")
    assert "whitespace" in codes("Save", " Guardar")


def test_missing_is_reported_for_a_key_with_no_translation_at_all():
    findings = run_checks(
        source_flat={"a.b": "Save", "a.c": "Open"},
        target_flat={"a.b": "Guardar"},
        ctx=CTX,
    )
    assert findings == [{"key": "a.c", "code": "missing", "detail": "no translation was written"}]


def test_every_finding_has_the_key_code_detail_shape_the_triage_feed_needs():
    findings = run_checks(
        source_flat={"bad": "Delete {n} note?"},
        target_flat={"bad": "Eliminar {3} nota"},
        ctx=CTX,
    )
    assert len(findings) >= 3
    for f in findings:
        assert f["key"] == "bad"
        assert isinstance(f["code"], str)
        assert len(f["detail"]) > 0, f"code {f['code']} produced an empty detail"
