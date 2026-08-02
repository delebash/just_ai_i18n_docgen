# SPDX-License-Identifier: MIT
"""The extractor OWNS two prefixes in the source locale and must not touch anything
else. Both halves are dangerous if wrong: a generator that clobbers hand-written copy
is one nobody dares run, and one that leaves deleted hints behind ships text to nine
languages that no document says any more. Ported from just-ai-help's
`test/extract.test.js` plus the front-matter parser's own biting cases."""

from __future__ import annotations

import json

import pytest

from just_ai_i18n_docgen.extract import run_extract
from just_ai_i18n_docgen.frontmatter import parse_front_matter
from just_ai_i18n_docgen.service import Project


def quiet(_msg):
    pass


def fixture(tmp_path, *, docs: dict, en: dict):
    docs_dir = tmp_path / "docs"
    locales = tmp_path / "locales"
    docs_dir.mkdir()
    locales.mkdir()
    for name, text in docs.items():
        (docs_dir / name).write_text(text, encoding="utf-8")
    (locales / "en.json").write_text(json.dumps(en, indent=2) + "\n", encoding="utf-8")
    config = tmp_path / "config.json"
    config.write_text(json.dumps({
        "source": "locales/en.json", "targets": [], "docsDir": "docs",
    }), encoding="utf-8")
    return config


def read_en(config):
    return json.loads((config.parent / "locales" / "en.json").read_text(encoding="utf-8"))


FM = "\n".join(["---", "lede: The heart of the app.", "hints:",
                "  status: Whether it is done.", "---", "# Writing"])


def test_extracts_lede_and_hints_keyed_by_slug_and_leaves_handwritten_keys_alone(tmp_path):
    config = fixture(tmp_path, docs={"writing.md": FM}, en={"common": {"save": "Save"}})
    run_extract(Project(config), log=quiet)
    en = read_en(config)
    assert en["lede"]["writing"] == "The heart of the app."
    assert en["hints"]["writing"]["status"] == "Whether it is done."
    assert en["common"]["save"] == "Save"


def test_bites_a_hint_deleted_from_the_doc_is_removed_from_the_locale(tmp_path):
    two = "\n".join(["---", "hints:", "  a: One.", "  b: Two.", "---", "# W"])
    config = fixture(tmp_path, docs={"writing.md": two}, en={})
    run_extract(Project(config), log=quiet)
    assert read_en(config)["hints"]["writing"]["b"] == "Two."

    (config.parent / "docs" / "writing.md").write_text(
        "\n".join(["---", "hints:", "  a: One.", "---", "# W"]), encoding="utf-8")
    run_extract(Project(config), log=quiet)
    en = read_en(config)
    assert en["hints"]["writing"]["a"] == "One."
    assert "b" not in en["hints"]["writing"], "a deleted hint must not linger"


def test_bites_check_reports_stale_and_writes_nothing(tmp_path):
    config = fixture(tmp_path, docs={"writing.md": FM}, en={"common": {"save": "Save"}})
    before = (config.parent / "locales" / "en.json").read_text(encoding="utf-8")
    result = run_extract(Project(config), check=True, log=quiet)
    assert result["stale"] is True
    assert (config.parent / "locales" / "en.json").read_text(encoding="utf-8") == before, (
        "--check must not write"
    )
    run_extract(Project(config), log=quiet)  # make it current
    assert run_extract(Project(config), check=True, log=quiet)["stale"] is False


def test_bites_a_broken_doc_fails_the_run_and_names_the_file(tmp_path):
    bad = "\n".join(["---", "hints:", "\tstatus: Tabbed.", "---", "# Bad"])
    config = fixture(tmp_path, docs={"bad.md": bad}, en={})
    with pytest.raises(ValueError, match=r"bad\.md.*tabs"):
        run_extract(Project(config), log=quiet)


def test_docs_with_no_front_matter_are_simply_skipped(tmp_path):
    config = fixture(tmp_path, docs={
        "plain.md": "# Plain\n\nJust prose.\n",
        "withfm.md": "\n".join(["---", "lede: Yes.", "---", "# X"]),
    }, en={})
    run_extract(Project(config), log=quiet)
    en = read_en(config)
    assert en["lede"]["withfm"] == "Yes."
    assert "plain" not in en["lede"]


def test_a_flat_locale_with_dotted_keys_is_not_restructured(tmp_path):
    config = fixture(tmp_path, docs={
        "writing.md": "\n".join(["---", "lede: Text.", "---", "# W"]),
    }, en={"common.save": "Save", "common.cancel": "Cancel"})
    run_extract(Project(config), log=quiet)
    en = read_en(config)
    assert en["common.save"] == "Save", "existing flat keys must stay flat"
    assert en["lede.writing"] == "Text.", "generated keys follow the file's own shape"
    assert "lede" not in en, "must not nest into a file that is flat"


# ── the parser's own refusals — succeed-and-drop is the failure mode ─────────────────


def test_parser_refuses_what_it_does_not_understand():
    for text, why in [
        ("---\nlede: |\n  multi\n---\nbody", "multi-line"),
        ("---\n- item\n---\nbody", "lists"),
        ("---\nhints:\n  deep:\n    more: x\n---\nbody", "deeper than one level"),
        ("---\nlede: a\nlede: b\n---\nbody", "duplicate"),
        ("---\nlede: a\n", "no closing"),
        ("---\n  orphan: x\n---\nbody", "no parent"),
    ]:
        with pytest.raises(ValueError, match=why):
            parse_front_matter(text)


def test_parser_handles_quotes_comments_and_no_fence():
    data, body = parse_front_matter(
        '---\nlede: "Quoted: with a colon."\n# a comment\nhints:\n  a: x\n---\n# Body\n')
    assert data == {"lede": "Quoted: with a colon.", "hints": {"a": "x"}}
    assert body.startswith("# Body")
    data, body = parse_front_matter("# Just a doc\n")
    assert data == {} and body == "# Just a doc\n"
