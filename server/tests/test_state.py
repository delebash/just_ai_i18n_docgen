# SPDX-License-Identifier: MIT
"""Workshop state — the atomic JSON store and its slices. The load-bearing behaviours:
a corrupt file costs state never work, an unreversible action refuses to be recorded,
and mutations re-read so a concurrent writer's change is not silently discarded."""

from __future__ import annotations

import json

import pytest

from just_ai_i18n_docgen.state import (
    confirmations,
    drop_proposal,
    last_action,
    open_project,
    pop_action,
    proposal_count,
    put_confirmation,
    put_proposal,
    record_action,
    write_json_atomic,
)


def test_open_project_creates_on_first_mutation_and_roundtrips(tmp_path):
    s = open_project(tmp_path)
    put_proposal(s, lang="es", key="a", engine="e1", value="hola")
    reread = open_project(tmp_path)
    assert proposal_count(reread, "es") == 1


def test_a_corrupt_state_file_costs_state_never_work(tmp_path):
    (tmp_path / ".jah-state.json").write_text("{ not json", encoding="utf-8")
    s = open_project(tmp_path)
    assert s.read()["version"] == 1, "corrupt -> fresh empty state, no crash"


def test_atomic_write_leaves_no_tmp_and_survives_reread(tmp_path):
    path = tmp_path / "x.json"
    write_json_atomic(path, {"a": 1})
    assert json.loads(path.read_text(encoding="utf-8")) == {"a": 1}
    assert not path.with_name("x.json.tmp").exists()


def test_mutate_rereads_so_the_other_writers_change_survives(tmp_path):
    a = open_project(tmp_path)
    b = open_project(tmp_path)  # the review page and a CLI run, both open
    put_proposal(a, lang="es", key="k1", engine="e", value="v1")
    put_proposal(b, lang="es", key="k2", engine="e", value="v2")  # b re-reads first
    assert proposal_count(open_project(tmp_path), "es") == 2, "neither write was lost"


def test_record_action_requires_a_reversible_prev(tmp_path):
    s = open_project(tmp_path)
    with pytest.raises(TypeError):
        record_action(s, lang="es", kind="edit")  # no prev at all — cannot be undone
    with pytest.raises(ValueError, match="unknown action kind"):
        record_action(s, lang="es", kind="explode", prev=None)


def test_pop_action_marks_undone_and_returns_prev_for_the_caller(tmp_path):
    s = open_project(tmp_path)
    record_action(s, lang="es", key="a", kind="edit", prev="old", next_value="new")
    record_action(s, lang="fr", key="b", kind="edit", prev="ancien", next_value="neuf")
    popped = pop_action(s, lang="es")
    assert popped["prev"] == "old", "prev is what the caller restores"
    assert last_action(s, "es") is None, "the es action is spent"
    assert last_action(s, "fr")["key"] == "b", "the fr action is untouched"


def test_confirmation_verdicts_validate_and_roundtrip(tmp_path):
    s = open_project(tmp_path)
    with pytest.raises(ValueError, match="unknown verdict"):
        put_confirmation(s, lang="es", key="k", hash="h", verdict="maybe", engine="e")
    put_confirmation(s, lang="es", key="k", hash="h1", verdict="same", engine="e")
    assert confirmations(s, "es")["k"]["verdict"] == "same"
    put_confirmation(s, lang="es", key="k", hash="h2", verdict="translate",
                     suggestion="hola", engine="e")
    v = confirmations(s, "es")["k"]
    assert v["hash"] == "h2" and v["suggestion"] == "hola", "a re-ask replaces the verdict"


def test_drop_proposal_by_engine_then_key(tmp_path):
    s = open_project(tmp_path)
    put_proposal(s, lang="es", key="a", engine="e1", value="v1")
    put_proposal(s, lang="es", key="a", engine="e2", value="v2")
    drop_proposal(s, lang="es", key="a", engine="e1")
    assert proposal_count(s, "es") == 1, "one engine's proposal gone, the key remains"
    drop_proposal(s, lang="es", key="a", engine="e2")
    assert proposal_count(s, "es") == 0, "last engine's removal removes the key"
