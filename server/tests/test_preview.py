# SPDX-License-Identifier: MIT
"""The prompt-preview seam behind POST /v1/ai/prompt-preview: the REAL builders over a
small live sample — shielding included — with loud, NAMED empties. The kit's promptless
Lab renders exactly these strings, so what the reviewer tunes is what production sends."""

import json

import pytest
from fastapi import HTTPException

from just_ai_i18n_docgen.service import Project
from just_ai_i18n_docgen.workspace import _preview_confirm, _preview_translate

EN = {
    "app": {"hello": "Hello {name}", "books": "Books"},
    "common": {"no": "No"},
}


@pytest.fixture
def project(tmp_path):
    tool_dir = tmp_path / "app" / "tool"
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


def _write_target(project, values):
    path = project.paths.target_file("es")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(values), encoding="utf-8")


def test_translate_preview_is_the_real_shielded_prompt(project):
    out = _preview_translate(project, "es", None)
    assert "es" in out["system"], "the system prompt names the target language"
    # The placeholder is SHIELDED: the model sees the token, never the raw {name} —
    # the same substitution a production batch performs.
    assert "{name}" not in out["user"]
    assert "Translate items:" in out["user"]
    assert out["sample"] == "3 pending key(s) · es"


def test_translate_preview_honours_requested_keys(project):
    out = _preview_translate(project, "es", ["common.no"])
    assert '"Books"' not in out["user"]
    assert "No" in out["user"]
    assert out["sample"] == "1 pending key(s) · es"


def test_translate_preview_names_the_empty(project):
    _write_target(project, {"app": {"hello": "Hola x", "books": "Libros"},
                            "common": {"no": "No"}})
    with pytest.raises(HTTPException) as e:
        _preview_translate(project, "es", None)
    assert "pending" in str(e.value.detail), "nothing to sample must say WHY, never fabricate"


def test_confirm_preview_needs_an_identical_key(project):
    with pytest.raises(HTTPException) as e:
        _preview_confirm(project, "es", None)
    assert "identical" in str(e.value.detail).lower()


def test_confirm_preview_asks_about_the_identical_key(project):
    _write_target(project, {"common": {"no": "No"}})
    out = _preview_confirm(project, "es", None)
    assert "SAME" in out["system"], "the probe prompt names the SAME verdict explicitly"
    assert '"text": "No"' in out["user"], "one key per call, the make_ask shape"
    assert "common.no" in out["sample"]
