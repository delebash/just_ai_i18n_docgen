# SPDX-License-Identifier: MIT
"""Path resolution — the rule is that everything anchors to the CONFIG FILE, never the
working directory. The Node original's test ran the resolver from an unrelated directory
so the cwd bug (27 minutes and 464 hand-corrected keys, 2026-07-31) cannot come back;
so does this one."""

from __future__ import annotations

import json

import pytest

from just_ai_i18n_docgen.paths import project_paths


@pytest.fixture(autouse=True)
def far_away_cwd(tmp_path_factory, monkeypatch):
    """EVERY test here runs from an unrelated directory — the resolver must not care."""
    monkeypatch.chdir(tmp_path_factory.mktemp("unrelated-cwd"))


def _project(tmp_path, cfg):
    app = tmp_path / "app"
    (app / "just-ai-i18n-docgen").mkdir(parents=True)
    (app / "src" / "i18n" / "locales").mkdir(parents=True)
    (app / "src" / "i18n" / "locales" / "en.json").write_text("{}", encoding="utf-8")
    config = app / "just-ai-i18n-docgen" / "config.json"
    config.write_text(json.dumps(cfg), encoding="utf-8")
    return config


def test_source_shaped_config_one_field_three_facts(tmp_path):
    config = _project(tmp_path, {"source": "../src/i18n/locales/en.json"})
    p = project_paths(config, json.loads(config.read_text(encoding="utf-8")))
    assert p.source_language == "en"
    assert p.source_file.name == "en.json"
    assert p.locales_dir == p.source_file.parent
    assert p.target_file("es") == p.locales_dir / "es.json"


def test_point_it_at_es_and_spanish_is_the_source(tmp_path):
    # sourceLanguage used to default to "en" invisibly; the FILENAME is the fact now.
    config = _project(tmp_path, {"source": "../src/i18n/locales/es.json"})
    p = project_paths(config, {"source": "../src/i18n/locales/es.json"})
    assert p.source_language == "es"


def test_legacy_folder_shaped_config_still_works(tmp_path):
    config = _project(tmp_path, {"locales": "../src/i18n/locales", "sourceLanguage": "en"})
    p = project_paths(config, {"locales": "../src/i18n/locales", "sourceLanguage": "en"})
    assert p.source_file == p.locales_dir / "en.json"
    assert p.source_language == "en"


def test_a_config_naming_nothing_fails_loudly(tmp_path):
    config = _project(tmp_path, {})
    with pytest.raises(ValueError, match="source"):
        project_paths(config, {})


def test_sidecars_sit_beside_the_config_and_cache_anchors_there_too(tmp_path):
    config = _project(tmp_path, {"source": "../src/i18n/locales/en.json"})
    p = project_paths(config, {"source": "../src/i18n/locales/en.json"})
    assert p.sidecar_dir == config.parent
    assert p.accepted_file("es") == config.parent / "es.accepted.json"
    assert p.cache_path == config.parent / ".just-ai-i18n-docgen-cache.json"


def test_legacy_sidecars_in_locales_win_so_an_upgrade_orphans_nothing(tmp_path):
    config = _project(tmp_path, {"source": "../src/i18n/locales/en.json"})
    locales = config.parent.parent / "src" / "i18n" / "locales"
    # A pre-2026-07-31 project keeps its verdicts in locales/ — that location wins,
    # decided ONCE for the whole project so sidecars for one language stay together.
    (locales / "es.accepted.json").write_text("{}", encoding="utf-8")
    p = project_paths(config, {"source": "../src/i18n/locales/en.json"})
    assert p.sidecar_dir == locales
    assert p.notes_file("es") == locales / "es.notes.json"
