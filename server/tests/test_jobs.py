# SPDX-License-Identifier: MIT
"""The JobManager's three rules — jobs.py claims "each of which is a test", and the
overnight re-review (2026-08-02) found rules 2 and 3 were NOT. Now the claim is true.
Driven through an injectable translate, no engine, no socket."""

from __future__ import annotations

import threading

import pytest

from just_ai_i18n_docgen.jobs import JobBusyError, JobManager
from just_ai_i18n_docgen.state import open_project, proposal_count, run_history


def controllable_translate(gate: threading.Event, batches: list[dict]):
    """A fake loop: stages each batch via on_batch, waiting on `gate` between them and
    honoring is_cancelled on the boundary — the real loop's contract."""
    def translate(*, source_flat, existing_flat, lang, cfg, cache_path, send, force,
                  log, is_cancelled, on_batch):
        values = {}
        for batch in batches:
            gate.wait(timeout=10)
            gate.clear()
            if is_cancelled():
                return {"values": values, "failed": [], "requests": len(values),
                        "cancelled": True}
            values.update(batch)
            on_batch(dict(values))
        return {"values": values, "failed": [], "requests": len(batches),
                "cancelled": False}
    return translate


def test_rule_2_one_job_at_a_time_a_second_start_is_refused(tmp_path):
    store = open_project(tmp_path)
    jobs = JobManager(store=store)
    gate = threading.Event()
    jobs.start(lang="es", engine="e", send=None, scope="all", subset={"a": "A"},
               cfg={}, cache_path=tmp_path / "c.json",
               translate=controllable_translate(gate, [{"a": "x"}]))
    try:
        with pytest.raises(JobBusyError):
            jobs.start(lang="es", engine="e", send=None, scope="all", subset={"a": "A"},
                       cfg={}, cache_path=tmp_path / "c.json",
                       translate=controllable_translate(threading.Event(), []))
    finally:
        gate.set()
        jobs.settled()
    assert jobs.status()["state"] == "done"


def test_rule_3_cancel_keeps_everything_already_staged(tmp_path):
    store = open_project(tmp_path)
    jobs = JobManager(store=store)
    gate = threading.Event()
    jobs.start(lang="es", engine="e", send=None, scope="all",
               subset={"a": "A", "b": "B"}, cfg={}, cache_path=tmp_path / "c.json",
               translate=controllable_translate(gate, [{"a": "x"}, {"b": "y"}]))
    gate.set()                      # let batch 1 stage
    while jobs.status()["done"] < 1:
        pass
    jobs.cancel()                   # stop on the boundary
    gate.set()                      # release the wait; the fake sees is_cancelled
    jobs.settled()
    assert jobs.status()["state"] == "cancelled"
    # Everything already staged STAYS staged — cancelling loses nothing.
    assert proposal_count(store, "es") == 1
    # And the run history records how far it got, not a lie.
    run = run_history(store)[0]
    assert run["keys"] == 1 and run["finishedAt"] is not None


def test_a_dead_engine_is_a_recorded_outcome_not_a_hang(tmp_path):
    store = open_project(tmp_path)
    jobs = JobManager(store=store)

    def exploding_translate(**_kw):
        raise RuntimeError("engine offline")

    jobs.start(lang="es", engine="e", send=None, scope="all", subset={"a": "A"},
               cfg={}, cache_path=tmp_path / "c.json", translate=exploding_translate)
    jobs.settled()
    st = jobs.status()
    assert st["state"] == "failed" and "engine offline" in st["error"]
    assert run_history(store)[0]["finishedAt"] is not None, "the run closed its record"
    assert not jobs.busy, "a failed job frees the slot for the next start"


def test_done_run_hands_its_identical_proposals_to_the_confirm_pass(tmp_path):
    """The design's pre-tick (2026-08-04 — only the CLI ran it before): a finished
    run calls the injected confirm with EXACTLY the byte-identical proposals, in a
    NON-terminal `confirming` state (busy HOLDS — the 2026-08-05 busy-guard fix);
    a failure inside confirm never fails the run whose translations already staged."""
    store = open_project(tmp_path)
    jobs = JobManager(store=store)
    gate = threading.Event()
    seen: list[dict] = []
    states_during_confirm: list[tuple[str, bool]] = []

    def confirm(identical, *, is_cancelled=None):
        states_during_confirm.append((jobs.status()["state"], jobs.busy))
        seen.append(identical)

    jobs.start(lang="es", engine="e", send=None, scope="all",
               subset={"same": "No", "moved": "Hello"},
               cfg={}, cache_path=tmp_path / "c.json",
               translate=controllable_translate(gate, [{"same": "No", "moved": "Hola"}]),
               confirm=confirm)
    gate.set()
    jobs.settled()
    assert jobs.status()["state"] == "done"
    assert seen == [{"same": "No"}], "only the byte-identical proposal is confirmed"
    assert states_during_confirm == [("confirming", True)], \
        "the pass runs INSIDE a busy, non-terminal state — a second job cannot start over it"

    # A confirm that BLOWS UP is an annotation failure, not a run failure.
    jobs2 = JobManager(store=store)
    gate2 = threading.Event()

    def boom(_identical, *, is_cancelled=None):
        raise RuntimeError("engine down")

    jobs2.start(lang="es", engine="e", send=None, scope="all", subset={"same": "No"},
                cfg={}, cache_path=tmp_path / "c2.json",
                translate=controllable_translate(gate2, [{"same": "No"}]),
                confirm=boom)
    gate2.set()
    jobs2.settled()
    assert jobs2.status()["state"] == "done"

    # Cancel DURING confirming stops the pass between keys; the run stays done
    # (the translate outcome), and the callable saw the cancel flag.
    jobs3 = JobManager(store=store)
    gate3 = threading.Event()
    confirmed_keys: list[str] = []

    def slow_confirm(identical, *, is_cancelled=None):
        for k in sorted(identical):
            if is_cancelled():
                return
            confirmed_keys.append(k)
            jobs3.cancel()  # cancel arrives after the first key
    jobs3.start(lang="es", engine="e", send=None, scope="all",
                subset={"a": "A", "b": "B"},
                cfg={}, cache_path=tmp_path / "c3.json",
                translate=controllable_translate(gate3, [{"a": "A", "b": "B"}]),
                confirm=slow_confirm)
    gate3.set()
    jobs3.settled()
    assert confirmed_keys == ["a"], "the second key was never confirmed after cancel"
    assert jobs3.status()["state"] == "done"
