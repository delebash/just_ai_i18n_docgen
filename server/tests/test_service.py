# SPDX-License-Identifier: MIT
"""The translate service — the whole flow through a fake engine, on a real tmp project.

What must hold: the flow writes real files in the source's shape, the check is offline
and deterministic, an acceptance flips the gate green AND expires with its strings, the
confirmation pass annotates without ever signing off, and escalation spends the strong
engine only on the keys that earned it while retiring their stale probe entries."""

from __future__ import annotations

import json
import re

import pytest

from just_ai_i18n_docgen import service
from just_ai_i18n_docgen.service import (
    Project,
    accept_keys,
    all_findings,
    run_check,
    run_escalate,
    run_translate,
)

EN = {
    "greet": "Hello {name}",
    "sidebar": {"books": "Books"},
    "common": {"no": "No"},
}


def fake_send(system: str, user: str) -> str:
    """Deterministic engine: real Spanish for the two translatable keys, the cognate
    left identical — the shape of a real catalogue."""
    items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.DOTALL).group(1))
    answers = {"Hello ⟦0⟧": "Hola ⟦0⟧", "Books": "Libros", "No": "No"}
    return json.dumps({"items": [
        {"id": it["id"], "translation": answers.get(it["text"], f"XX {it['text']}")}
        for it in items
    ]})


@pytest.fixture
def project(tmp_path):
    tool_dir = tmp_path / "app" / "just-ai-i18n-docgen"
    locales = tmp_path / "app" / "src" / "locales"
    tool_dir.mkdir(parents=True)
    locales.mkdir(parents=True)
    (locales / "en.json").write_text(json.dumps(EN), encoding="utf-8")
    config = tool_dir / "config.json"
    config.write_text(json.dumps({
        "source": "../src/locales/en.json",
        "targets": ["es"],
        "context": "a test app",
        "glossary": [],
    }), encoding="utf-8")
    return Project(config)


def quiet(_msg):
    pass


def test_translate_writes_the_locale_file_in_source_shape(project):
    result = run_translate(project, send=fake_send, no_confirm=True, log=quiet)
    assert result["hard_failures"] == 0
    es = json.loads(project.paths.target_file("es").read_text(encoding="utf-8"))
    assert es == {"greet": "Hola {name}", "sidebar": {"books": "Libros"},
                  "common": {"no": "No"}}
    assert project.paths.cache_path.exists(), "the cache landed beside the config"


def test_check_is_offline_and_the_cognate_costs_one_finding(project):
    run_translate(project, send=fake_send, no_confirm=True, log=quiet)
    check = run_check(project, log=quiet)
    # "No" -> "No" raises untranslated — the correct answer, flagged. This is exactly
    # why acceptances exist; a perfect catalogue must be able to reach green.
    assert check["failed"] == 1
    codes = [f["code"] for f in check["langs"]["es"]["findings"]]
    assert codes == ["untranslated"]


def test_accept_flips_the_gate_green_and_expires_with_the_source(project):
    run_translate(project, send=fake_send, no_confirm=True, log=quiet)
    # A machine verdict sits on the key; the CLI accept must retire it like the
    # workspace door does (audit 2026-08-05: it didn't — stale pre-ticks).
    from just_ai_i18n_docgen.state import confirmations, put_confirmation

    put_confirmation(project.state, lang="es", key="common.no",
                     hash="h-stale", verdict="same", engine="e")
    result = accept_keys(project, ["common.no"], by="tester", log=quiet)
    assert result == {"recorded": 1, "reviewer": "tester"}
    assert confirmations(project.state, "es").get("common.no") is None, (
        "the CLI accept retires the machine verdict")
    assert run_check(project, log=quiet)["failed"] == 0, "the gate CAN go green"
    accepted = json.loads(project.paths.accepted_file("es").read_text(encoding="utf-8"))
    entry = next(iter(accepted.values()))
    assert entry["by"] == "tester", "the verdict carries the human's name"

    # BITES: the pair changes — the same key now holds a DIFFERENT identical pair
    # ("Yes"/"Yes"), so untranslated fires again and the old No/No acceptance must NOT
    # cover it. An acceptance is a statement about one exact pair of strings, never a
    # standing exemption for a key.
    en2 = dict(EN)
    en2["common"] = {"no": "Yes"}
    project.paths.source_file.write_text(json.dumps(en2), encoding="utf-8")
    es2 = json.loads(project.paths.target_file("es").read_text(encoding="utf-8"))
    es2["common"]["no"] = "Yes"
    project.paths.target_file("es").write_text(json.dumps(es2), encoding="utf-8")
    reloaded = Project(project.config_path)
    findings, accepted_now = all_findings(reloaded, "es", reloaded.target_flat("es"))
    assert any(f["key"] == "common.no" and f["code"] == "untranslated" for f in findings)
    assert accepted_now == []


def test_confirmation_pass_annotates_and_never_touches_the_accepted_file(project):
    run_translate(project, send=fake_send, ask=lambda system, source: "SAME", log=quiet)
    # The verdict landed in WORKSHOP STATE and pre-ticks the finding…
    findings, _ = all_findings(project, "es", project.target_flat("es"))
    identical = next(f for f in findings if f["key"] == "common.no")
    assert identical["confirmed"] == "same"
    # …but the finding still COUNTS, and the human record was never written: the engine
    # never signs off.
    assert run_check(project, log=quiet)["failed"] == 1
    assert not project.paths.accepted_file("es").exists()


def test_confirmation_proposals_are_shown_never_applied(project):
    run_translate(project, send=fake_send, ask=lambda system, source: "Núm.", log=quiet)
    findings, _ = all_findings(project, "es", project.target_flat("es"))
    identical = next(f for f in findings if f["key"] == "common.no")
    assert identical["confirmed"] == "translate"
    assert identical["suggestion"] == "Núm."
    es = json.loads(project.paths.target_file("es").read_text(encoding="utf-8"))
    assert es["common"]["no"] == "No", "the suggestion did NOT reach the locale file"


def test_probe_writes_its_sidecar_and_disagreements_are_advisory(project, monkeypatch):
    # The guard is the engine seam's job and has its own test; a unit-level probe run
    # must not need the whole shared stack booted.
    monkeypatch.setattr(service, "require_probe_temperature", lambda feature: None)
    calls = {"n": 0}

    def two_minds(system, user):
        calls["n"] += 1
        out = fake_send(system, user)
        # The second pass words one key differently — the model wandering where unsure.
        return out.replace("Libros", "Los libros") if calls["n"] > 1 else out

    result = run_translate(project, send=two_minds, probe=True, no_confirm=True, log=quiet)
    assert project.paths.probe_file("es").exists()
    assert result["langs"]["es"]["probe_moved"] == 1

    check = run_check(project, log=quiet)
    codes = {f["code"] for f in check["langs"]["es"]["findings"]}
    assert "disagreement" in codes
    # Advisory: only the cognate's untranslated counts toward failure, never suspicion.
    assert check["failed"] == 1


def test_zero_probe_movement_is_reported_as_instrument_trouble(project, monkeypatch):
    monkeypatch.setattr(service, "require_probe_temperature", lambda feature: None)
    logs = []
    run_translate(project, send=fake_send, probe=True, no_confirm=True, log=logs.append)
    assert any("agreed on EVERY key" in line for line in logs), (
        "a probe that finds nothing must say 'suspect the instrument', not look clean"
    )


def test_escalate_redoes_only_flagged_keys_and_retires_their_probe_entries(project, monkeypatch):
    run_translate(project, send=fake_send, no_confirm=True, log=quiet)
    # A probe sidecar with a disagreement on the flagged key AND one on a healthy key.
    project.paths.probe_file("es").write_text(json.dumps({
        "common": {"no": "Nop"}, "sidebar": {"books": "Los libros"},
    }), encoding="utf-8")

    sent_texts = []

    def strong_send(system, user):
        items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.DOTALL).group(1))
        sent_texts.extend(it["text"] for it in items)
        return json.dumps({"items": [
            {"id": it["id"], "translation": f"ES {it['text']}"} for it in items
        ]})

    monkeypatch.setattr(service, "make_send", lambda **kw: strong_send)
    out = run_escalate(project, "p_strong", log=quiet)

    # Only the flagged keys were spent on the strong engine: the cognate (untranslated)
    # and the two disagreement suspects — never the healthy greet key.
    assert "Hello ⟦0⟧" not in sent_texts
    assert out["es"]["before"] >= 2
    # The redone keys' probe entries are retired; comparing a strong answer to the weak
    # engine's probe would flag them forever.
    probe_left = json.loads(project.paths.probe_file("es").read_text(encoding="utf-8"))
    assert probe_left == {}, "every escalated key's probe entry was dropped"


def test_a_failing_engine_yields_hard_failures_and_a_named_key(project):
    def broken_send(system, user):
        raise RuntimeError("engine offline")

    result = run_translate(project, send=broken_send, no_confirm=True, log=quiet)
    assert result["hard_failures"] == len(project.src)
    assert sorted(result["langs"]["es"]["failed"]) == sorted(project.src)
