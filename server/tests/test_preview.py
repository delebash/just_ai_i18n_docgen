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


def test_translate_preview_samples_done_keys_when_finished(project):
    """A FINISHED language still shows the Lab (ruling 2026-08-04: 'def show the full
    lab') — the preview samples already-translated keys and SAYS so; the prompt is
    still the real shielded one."""
    _write_target(project, {"app": {"hello": "Hola x", "books": "Libros"},
                            "common": {"no": "No"}})
    out = _preview_translate(project, "es", None)
    assert "every key translated" in out["sample"]
    assert "done key(s)" in out["sample"]
    assert "{name}" not in out["user"], "the fallback sample is still shielded"


def test_confirm_preview_falls_back_when_nothing_identical(project):
    """A fresh project (nothing translated, nothing identical) still renders the Lab —
    the probe prompt's SHAPE is identical over any key; the sample names the fallback."""
    out = _preview_confirm(project, "es", None)
    assert "nothing translated yet" in out["sample"]
    assert "SAME" in out["system"]


def test_confirm_preview_requested_keys_stay_loud(project):
    """Explicit keys never silently fall back — asking for a specific key that is not
    byte-identical is answered with the named 400."""
    _write_target(project, {"common": {"no": "Não"}})
    with pytest.raises(HTTPException) as e:
        _preview_confirm(project, "es", ["common.no"])
    assert "requested" in str(e.value.detail).lower()


def test_preview_lang_default_is_the_busiest(tmp_path):
    """A922's agreed default: no lang given → the BUSIEST target. Translate = most
    pending; confirm = most byte-identical, then most translated."""
    from just_ai_i18n_docgen.workspace import _pick_preview_lang

    tool_dir = tmp_path / "app" / "tool"
    locales = tmp_path / "app" / "src" / "locales"
    tool_dir.mkdir(parents=True)
    locales.mkdir(parents=True)
    (locales / "en.json").write_text(json.dumps(EN), encoding="utf-8")
    (tool_dir / "config.json").write_text(json.dumps({
        "source": "../src/locales/en.json",
        "targets": ["es", "fr"],
        "context": "", "glossary": [],
    }), encoding="utf-8")
    p = Project(tool_dir / "config.json")
    # es fully translated (one byte-identical), fr untouched → translate goes to fr,
    # confirm goes to es.
    es = p.paths.target_file("es")
    es.parent.mkdir(parents=True, exist_ok=True)
    es.write_text(json.dumps({"app": {"hello": "Hola x", "books": "Libros"},
                              "common": {"no": "No"}}), encoding="utf-8")
    assert _pick_preview_lang(p, "translate") == "fr"
    assert _pick_preview_lang(p, "confirm") == "es"


def test_confirm_preview_asks_about_the_identical_key(project):
    _write_target(project, {"common": {"no": "No"}})
    out = _preview_confirm(project, "es", None)
    assert "SAME" in out["system"], "the probe prompt names the SAME verdict explicitly"
    assert '"text": "No"' in out["user"], "one key per call, the make_ask shape"
    assert "common.no" in out["sample"]
