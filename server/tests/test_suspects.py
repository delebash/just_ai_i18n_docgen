# SPDX-License-Identifier: MIT
"""The suspect list — spread + banded ranking. The measured behaviours: identical
passes are never suspects, accents survive tokenisation, short strings get slots the
long ones would otherwise take, and the finding carries the ALTERNATIVE rendering."""

from __future__ import annotations

from just_ai_i18n_docgen.suspects import rank_suspects, spread


def test_spread_zero_for_same_words_one_for_disjoint():
    assert spread("Eliminar nota", "Eliminar nota") == 0
    assert spread("Eliminar nota", "nota Eliminar") == 0, "word order does not register"
    assert spread("Eliminar la nota", "eliminar   la NOTA.") == 0, "case/punct/spacing ignored"
    assert spread("uno dos", "tres cuatro") == 1
    assert 0 < spread("Eliminar la nota", "Borrar la nota") < 1


def test_spread_is_accent_aware():
    # Unicode tokenisation: "capítulo" must not degrade to "cap tulo".
    assert spread("el capítulo", "el capitulo") > 0, "an accent difference IS a difference"


def test_identical_passes_are_never_suspects():
    findings = rank_suspects(
        source_flat={"a": "Delete", "b": "Save"},
        target_flat={"a": "Eliminar", "b": "Guardar"},
        probe_flat={"a": "Eliminar", "b": "Guardar"},
    )
    assert findings == []


def test_disagreement_findings_carry_the_alternative_rendering():
    findings = rank_suspects(
        source_flat={"a": "Collapse"},
        target_flat={"a": "Contraer"},
        probe_flat={"a": "Colapsar"},
    )
    assert len(findings) == 1
    f = findings[0]
    assert f["key"] == "a" and f["code"] == "disagreement"
    # The alternative IS the useful part: the reviewer judges by seeing what the second
    # pass said. A bare score would send them digging.
    assert "Colapsar" in f["detail"]
    assert "spread" in f["detail"]


def test_banding_gives_short_strings_slots_long_ones_would_take():
    # Three short keys with small spreads, three long paragraphs with big spreads. A flat
    # top-3 would be all paragraphs; banding must let short strings through — the
    # "End" -> "Finalizar" class of defect is three characters of source.
    source = {
        "s1": "End", "s2": "Top", "s3": "Add",
        "l1": "A long paragraph about chapters and drafts " * 4,
        "l2": "Another long paragraph about notes and books " * 4,
        "l3": "Yet another long paragraph about experts and prose " * 4,
    }
    target = {
        "s1": "Fin", "s2": "Cima", "s3": "Añadir",
        "l1": "Un párrafo largo x " * 4, "l2": "Otro párrafo largo y " * 4,
        "l3": "Otro más largo z " * 4,
    }
    probe = {
        "s1": "Finalizar", "s2": "Parte superior", "s3": "Agregar",
        "l1": "Texto totalmente distinto aquí " * 4, "l2": "Nada en común con antes " * 4,
        "l3": "Completamente diferente otra vez " * 4,
    }
    picked = {f["key"] for f in rank_suspects(
        source_flat=source, target_flat=target, probe_flat=probe, top_n=3, band_count=3,
    )}
    assert any(k.startswith("s") for k in picked), "short strings must not lose every slot"


def test_top_n_bounds_the_list_and_zero_means_none():
    source = {f"k{i}": f"word {i}" for i in range(10)}
    target = {f"k{i}": f"palabra {i}" for i in range(10)}
    probe = {f"k{i}": f"término {i}" for i in range(10)}
    assert len(rank_suspects(source_flat=source, target_flat=target, probe_flat=probe, top_n=4)) == 4
    assert rank_suspects(source_flat=source, target_flat=target, probe_flat=probe, top_n=0) == []


def test_a_key_missing_from_either_side_is_skipped_not_crashed():
    findings = rank_suspects(
        source_flat={"a": "Delete", "b": "Save"},
        target_flat={"a": "Borrar"},
        probe_flat={"a": "Eliminar"},
    )
    assert [f["key"] for f in findings] == ["a"]
