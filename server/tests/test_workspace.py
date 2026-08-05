# SPDX-License-Identifier: MIT
"""The review workspace API — the flows ported from server.test.js that carry the
design's promises: a job writes ONLY proposals, one call is one undo, an acceptance can
be revisited, setup works with NO project, and every write path retires the machine
opinions that were about the old text."""

from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient
from llm_runner.llm import seed
from llm_runner.runner import lifecycle

from just_ai_i18n_docgen.app import create_app

EN = {"greet": "Hello {name}", "sidebar": {"books": "Books"}, "common": {"no": "No"}}


def make_project(tmp_path):
    app_dir = tmp_path / "myapp"
    (app_dir / "src" / "locales").mkdir(parents=True)
    (app_dir / "package.json").write_text("{}", encoding="utf-8")
    (app_dir / "src" / "locales" / "en.json").write_text(json.dumps(EN), encoding="utf-8")
    (app_dir / "src" / "locales" / "es.json").write_text(json.dumps({
        "greet": "Hola {name}", "sidebar": {"books": "Libros"}, "common": {"no": "No"},
    }), encoding="utf-8")
    (app_dir / "just-ai-i18n-docgen").mkdir()
    config = app_dir / "just-ai-i18n-docgen" / "config.json"
    config.write_text(json.dumps({
        "source": "../src/locales/en.json", "targets": ["es"], "context": "a test app",
    }), encoding="utf-8")
    return config


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(lifecycle, "_service", None)
    monkeypatch.setattr(seed, "_APP", dict(seed._APP))
    config = make_project(tmp_path)
    app = create_app(tmp_path / "data", config_path=config)
    c = TestClient(app)
    c.config_path = config
    return c


def test_state_reports_langs_progress_and_no_job(client):
    s = client.get("/v1/state").json()
    assert s["langs"] == ["es"] and s["job"] is None
    assert s["progress"]["es"] == {"reviewed": 0, "skipped": 0}


def test_rows_carry_the_cognate_finding_and_missing_keys(client):
    # Delete one key from es.json so `missing` shows too.
    es_path = client.config_path.parent.parent / "src" / "locales" / "es.json"
    es = json.loads(es_path.read_text(encoding="utf-8"))
    del es["greet"]
    es_path.write_text(json.dumps(es), encoding="utf-8")

    body = client.get("/v1/rows").json()
    by_key = {r["key"]: r for r in body["rows"]}
    assert "untranslated" in [f["code"] for f in by_key["common.no"]["flags"]]
    assert by_key["greet"]["flags"][0]["code"] == "missing"
    assert body["counts"]["missing"] == 1


def test_save_writes_the_locale_rechecks_and_records_an_undoable_edit(client):
    r = client.post("/v1/save", json={"lang": "es", "key": "sidebar.books",
                                       "value": "Los libros"})
    assert r.status_code == 200
    es = json.loads((client.config_path.parent.parent / "src" / "locales" / "es.json")
                    .read_text(encoding="utf-8"))
    assert es["sidebar"]["books"] == "Los libros"

    # Undo puts the previous value back.
    client.post("/v1/undo", json={})
    es = json.loads((client.config_path.parent.parent / "src" / "locales" / "es.json")
                    .read_text(encoding="utf-8"))
    assert es["sidebar"]["books"] == "Libros"


def test_save_to_an_unknown_key_is_404(client):
    assert client.post("/v1/save", json={"lang": "es", "key": "nope",
                                          "value": "x"}).status_code == 404


def test_bulk_accept_is_one_undo_and_unaccept_can_revisit(client):
    r = client.post("/v1/accept", json={"lang": "es", "keys": ["common.no"]})
    assert r.status_code == 200 and r.json()["recorded"] == 1
    assert client.get("/v1/rows").json()["counts"].get("untranslated") is None
    accepted = client.get("/v1/accepted", params={"lang": "es"}).json()["entries"]
    assert len(accepted) == 1
    # Unclaimed reviewer: the entry says "unknown" rather than borrowing a name.
    assert accepted[0]["by"] == "unknown"

    # Unaccept — the fix for the one-way complaint.
    r = client.request("DELETE", "/v1/accept", json={"lang": "es", "key": "common.no"})
    assert r.json()["removed"] == 1
    assert client.get("/v1/rows").json()["counts"]["untranslated"] == 1

    # Undo the unaccept: the entries come back.
    client.post("/v1/undo", json={})
    assert len(client.get("/v1/accepted", params={"lang": "es"}).json()["entries"]) == 1


def test_reviewer_is_stored_in_the_app_db_and_stamps_acceptances(client):
    client.put("/v1/reviewer", json={"reviewer": "dana"})
    assert client.get("/v1/reviewer").json()["reviewer"] == "dana"
    client.post("/v1/accept", json={"lang": "es", "keys": ["common.no"]})
    entries = client.get("/v1/accepted", params={"lang": "es"}).json()["entries"]
    assert entries[0]["by"] == "dana"


def test_notes_roundtrip_and_undo(client):
    client.put("/v1/notes", json={"lang": "es", "key": "common.no",
                                   "note": "a label, not a question"})
    rows = client.get("/v1/rows").json()["rows"]
    row = next(r for r in rows if r["key"] == "common.no")
    assert row["note"] == "a label, not a question"
    client.post("/v1/undo", json={})
    row = next(r for r in client.get("/v1/rows").json()["rows"] if r["key"] == "common.no")
    assert row["note"] is None


def test_siblings_show_the_namespace_neighbours(client):
    body = client.get("/v1/siblings", params={"lang": "es", "key": "sidebar.books"}).json()
    assert body["namespace"] == "sidebar"


def test_a_job_stages_proposals_and_never_touches_the_locale_file(client, monkeypatch):
    """RULE 1 of jobs.js, the governing principle: the locale file is byte-identical
    when a run finishes; engine output is staged and applied by a person."""
    def fake_send(system, user):
        items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.DOTALL).group(1))
        return json.dumps({"items": [
            {"id": it["id"], "translation": f"NUEVO {it['text']}"} for it in items
        ]})

    from just_ai_i18n_docgen import workspace as ws_mod

    monkeypatch.setattr(ws_mod, "make_send", lambda *a, **k: fake_send)

    es_path = client.config_path.parent.parent / "src" / "locales" / "es.json"
    before = es_path.read_text(encoding="utf-8")

    r = client.post("/v1/jobs", json={"lang": "es", "scope": "all"})
    assert r.status_code == 202
    ws = client.app.state.workspace
    ws.jobs.settled()
    assert ws.jobs.status()["state"] == "done"

    assert es_path.read_text(encoding="utf-8") == before, (
        "a job must write ONLY proposals — the locale file is untouched"
    )
    props = client.get("/v1/proposals", params={"lang": "es"}).json()["proposals"]
    assert len(props) == len(EN["sidebar"]) + 2  # every key staged

    # Applying is the explicit human action that writes the file.
    r = client.post("/v1/proposals/apply", json={"lang": "es", "keys": ["common.no"]})
    assert r.json()["applied"] == ["common.no"]
    es = json.loads(es_path.read_text(encoding="utf-8"))
    assert es["common"]["no"].startswith("NUEVO")

    # …and it is UNDOABLE. Until 2026-08-03 `undo` had no branch for an applied
    # proposal: it popped the action, answered {"undone": …} and left the overwritten
    # text on disk. Applying is the only human action that writes locale files, so a
    # silent no-op here is the worst undo in the app.
    client.post("/v1/undo", json={})
    es = json.loads(es_path.read_text(encoding="utf-8"))
    assert es["common"]["no"] == "No", "undo must put the pre-apply text back"


def test_applying_many_proposals_is_ONE_undo(client, monkeypatch):
    """A run stages a proposal per key, so "apply what this run produced" is a
    whole-catalogue action — and 2,000 undo entries would put the one thing you want
    after a bad run (put it back) out of reach. One click, one undo: the bulk-accept
    promise, applied to writes."""
    def fake_send(system, user):
        items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.DOTALL).group(1))
        return json.dumps({"items": [
            {"id": it["id"], "translation": f"NUEVO {it['text']}"} for it in items
        ]})

    from just_ai_i18n_docgen import workspace as ws_mod

    monkeypatch.setattr(ws_mod, "make_send", lambda *a, **k: fake_send)
    es_path = client.config_path.parent.parent / "src" / "locales" / "es.json"
    before = json.loads(es_path.read_text(encoding="utf-8"))

    client.post("/v1/jobs", json={"lang": "es", "scope": "all"})
    client.app.state.workspace.jobs.settled()

    keys = [p["key"] for p in
            client.get("/v1/proposals", params={"lang": "es"}).json()["proposals"]]
    assert len(keys) > 1
    r = client.post("/v1/proposals/apply", json={"lang": "es", "keys": keys})
    assert sorted(r.json()["applied"]) == sorted(keys)
    after = json.loads(es_path.read_text(encoding="utf-8"))
    assert after["sidebar"]["books"].startswith("NUEVO")
    assert after["greet"].startswith("NUEVO")

    # ONE undo restores EVERY key the click wrote — not just the last one.
    client.post("/v1/undo", json={})
    assert json.loads(es_path.read_text(encoding="utf-8")) == before
    # …and there is nothing left to undo: the batch was a single action.
    assert client.post("/v1/undo", json={}).status_code == 404


def test_an_unknown_scope_must_not_start_a_job(client):
    r = client.post("/v1/jobs", json={"lang": "es", "scope": "everythingish"})
    assert r.status_code == 400
    assert "unknown scope" in r.json()["detail"]


def test_summary_reports_per_language_counts(client):
    """The dashboard's one call: counts per language, never the strings."""
    es_path = client.config_path.parent.parent / "src" / "locales" / "es.json"
    es = json.loads(es_path.read_text(encoding="utf-8"))
    del es["greet"]  # one missing key → done < total
    es_path.write_text(json.dumps(es), encoding="utf-8")

    body = client.get("/v1/summary").json()
    assert body["keyCount"] == 3 and body["source"] == "en"
    (lang,) = body["langs"]
    assert lang["code"] == "es"
    assert (lang["done"], lang["total"]) == (2, 3)
    # "No" is byte-identical to its source → at least the untranslated finding,
    # none of it reviewed yet, nothing accepted, no run recorded.
    assert lang["findings"] >= 1 and lang["unreviewed"] >= 1
    assert lang["accepted"] == 0 and lang["staged"] == 0 and lang["lastRun"] is None


def test_pending_scope_selects_missing_plus_flagged_keys(client, monkeypatch):
    """`flagged` alone selects NOTHING on a never-translated key — a missing key has
    no finding. `pending` is missing ∪ flagged, which is what the dashboard's
    Translate button means."""
    def fake_send(system, user):
        items = json.loads(re.search(r"Translate items: (\[.*\])$", user, re.DOTALL).group(1))
        return json.dumps({"items": [
            {"id": it["id"], "translation": f"NUEVO {it['text']}"} for it in items
        ]})

    from just_ai_i18n_docgen import workspace as ws_mod

    monkeypatch.setattr(ws_mod, "make_send", lambda *a, **k: fake_send)

    es_path = client.config_path.parent.parent / "src" / "locales" / "es.json"
    es = json.loads(es_path.read_text(encoding="utf-8"))
    del es["greet"]  # missing — invisible to `flagged`
    es_path.write_text(json.dumps(es), encoding="utf-8")

    r = client.post("/v1/jobs", json={"lang": "es", "scope": "pending"})
    assert r.status_code == 202
    ws = client.app.state.workspace
    ws.jobs.settled()
    assert ws.jobs.status()["state"] == "done"

    staged = {p["key"] for p in
              client.get("/v1/proposals", params={"lang": "es"}).json()["proposals"]}
    assert "greet" in staged, "the missing key must be in a pending run"
    assert "common.no" in staged, "the flagged key must be in a pending run"


def test_an_edit_retires_the_stale_machine_opinions(client):
    """The writeKey contract: probe entry, cached reference, staged proposal and
    confirmation verdict were all ABOUT the old text."""
    p = client.app.state.workspace.project
    # Stage a probe entry + a proposal + a reference for the key.
    (p.paths.probe_file("es")).write_text(json.dumps({"common": {"no": "Nop"}}),
                                          encoding="utf-8")
    from just_ai_i18n_docgen.state import get_reference, proposals, put_proposal, put_reference

    put_proposal(p.state, lang="es", key="common.no", engine="e", value="old proposal")
    put_reference(p.state, lang="es", key="common.no", engine="backtranslate", value="No")

    client.post("/v1/save", json={"lang": "es", "key": "common.no", "value": "Núm."})

    probe = json.loads(p.paths.probe_file("es").read_text(encoding="utf-8"))
    assert probe == {}, "the probe entry about the old text is gone"
    assert proposals(p.state, lang="es", key="common.no") == []
    assert get_reference(p.state, lang="es", key="common.no", engine="backtranslate") is None


def test_setup_flow_no_project_then_inspect_then_save_goes_live(tmp_path, monkeypatch):
    monkeypatch.setattr(lifecycle, "_service", None)
    monkeypatch.setattr(seed, "_APP", dict(seed._APP))
    config = make_project(tmp_path)
    en_path = config.parent.parent / "src" / "locales" / "en.json"
    config.unlink()  # no project yet

    client = TestClient(create_app(tmp_path / "data"))
    # Project routes refuse with needsSetup; setup routes work.
    r = client.get("/v1/state")
    assert r.status_code == 409 and r.json()["detail"]["needsSetup"] is True
    assert client.get("/v1/setup/state").json()["loaded"] is False

    # Inspect reports what it found and writes NOTHING.
    r = client.post("/v1/setup/inspect", json={"path": str(en_path)})
    body = r.json()
    assert body["keyCount"] == 3
    assert body["locales"][0]["code"] == "es"
    assert not config.exists()

    # Save writes the config and the page goes live WITHOUT a restart.
    r = client.post("/v1/setup/save", json={"path": str(en_path), "targets": ["es"],
                                             "context": "a test app"})
    assert r.json()["ok"] is True
    assert client.get("/v1/state").json()["langs"] == ["es"]
    cfg = json.loads(config.read_text(encoding="utf-8"))
    assert cfg["source"] == "../src/locales/en.json"
    assert "engine" not in cfg, "engines are presets in the shared DB now, never config"


def test_setup_save_preserves_fields_it_does_not_manage(tmp_path, monkeypatch):
    monkeypatch.setattr(lifecycle, "_service", None)
    monkeypatch.setattr(seed, "_APP", dict(seed._APP))
    config = make_project(tmp_path)
    cfg = json.loads(config.read_text(encoding="utf-8"))
    cfg["myCustomField"] = {"kept": True}
    config.write_text(json.dumps(cfg), encoding="utf-8")

    client = TestClient(create_app(tmp_path / "data", config_path=config))
    en_path = config.parent.parent / "src" / "locales" / "en.json"
    client.post("/v1/setup/save", json={"path": str(en_path), "targets": ["es"]})
    after = json.loads(config.read_text(encoding="utf-8"))
    assert after["myCustomField"] == {"kept": True}, "the UI is a writer, never an owner"


def test_terms_endpoint_answers_by_term(client):
    body = client.get("/v1/terms", params={"lang": "es", "term": "books"}).json()
    assert body["term"] == "books"


def test_setup_state_glossary_is_always_a_bare_list(tmp_path, monkeypatch):
    """The loaded cfg normalizes a list glossary to {"doNotTranslate": [...]} —
    the wire must hand the UI a BARE LIST anyway. The dict on the wire blew up
    the Setup prefill spread and let a Save erase the glossary (2026-08-05)."""
    monkeypatch.setattr(lifecycle, "_service", None)
    monkeypatch.setattr(seed, "_APP", dict(seed._APP))
    config = make_project(tmp_path)
    cfg = json.loads(config.read_text(encoding="utf-8"))
    cfg["glossary"] = ["Strands", "TODO"]
    config.write_text(json.dumps(cfg), encoding="utf-8")

    client = TestClient(create_app(tmp_path / "data", config_path=config))
    st = client.get("/v1/setup/state").json()
    assert st["glossary"] == ["Strands", "TODO"], "a bare list, never the dict"


def test_setup_save_without_glossary_preserves_the_existing_one(tmp_path, monkeypatch):
    """A field the caller didn't send falls back to the EXISTING config's value —
    plan_init's defaults must never overwrite the real glossary through the merge
    (the erasure chain, 2026-08-05)."""
    monkeypatch.setattr(lifecycle, "_service", None)
    monkeypatch.setattr(seed, "_APP", dict(seed._APP))
    config = make_project(tmp_path)
    cfg = json.loads(config.read_text(encoding="utf-8"))
    cfg["glossary"] = ["Strands"]
    cfg["context"] = "the real context"
    config.write_text(json.dumps(cfg), encoding="utf-8")

    client = TestClient(create_app(tmp_path / "data", config_path=config))
    en_path = config.parent.parent / "src" / "locales" / "en.json"
    r = client.post("/v1/setup/save", json={"path": str(en_path), "targets": ["es"]})
    assert r.json()["ok"] is True
    after = json.loads(config.read_text(encoding="utf-8"))
    assert after["glossary"] == ["Strands"], "an omitted glossary is PRESERVED"
    assert after["context"] == "the real context", "an omitted context is PRESERVED"

    # And sending one explicitly still writes it.
    client.post("/v1/setup/save", json={"path": str(en_path), "targets": ["es"],
                                        "glossary": ["RAG"]})
    after2 = json.loads(config.read_text(encoding="utf-8"))
    assert after2["glossary"] == ["RAG"]
