# SPDX-License-Identifier: MIT
"""The confirmation pass — the routing decision is the part worth asserting, with no
model running. The measured behaviours: an echo counts as SAME (15 of 71 answered that
way), a proposal is data never applied, an engine error is a routed outcome, and an
annotation EXPIRES with its strings exactly like an acceptance."""

from __future__ import annotations

from just_ai_i18n_docgen.accepted import acceptance_hash
from just_ai_i18n_docgen.confirm import (
    CONFIRM_CODE,
    attach_confirmations,
    build_confirm_prompt,
    confirm_identical,
    is_same_verdict,
)


def test_is_same_verdict_takes_same_in_any_case_and_the_echo():
    assert is_same_verdict("SAME", "Color")
    assert is_same_verdict("same", "Color")
    assert is_same_verdict("Same.", "Color"), "a trailing full stop is still SAME"
    # The echo: the model treats "return it unchanged" and "say SAME" as one statement.
    assert is_same_verdict("Color", "Color")
    assert is_same_verdict("Color.", "Color")
    # A real translation is NOT same.
    assert not is_same_verdict("Libros", "Books")


def test_confirm_prompt_names_the_glossary_and_the_language():
    p = build_confirm_prompt(target_lang="es", context="a writing app",
                             do_not_translate=["JustWrite", "TODO"])
    assert "es" in p and "a writing app" in p
    assert "JustWrite, TODO" in p
    bare = build_confirm_prompt(target_lang="es")
    assert "always SAME:" not in bare, "no glossary, no glossary line"


def test_confirm_identical_routes_cleared_proposed_and_failed():
    answers = {"common.no": "SAME", "sidebar.books": "Libros"}

    def ask(system, source):
        if source == "Boom":
            raise RuntimeError("engine down")
        return answers[next(k for k, s in SRC.items() if s == source)]

    SRC = {"common.no": "No", "sidebar.books": "Books", "bad.key": "Boom"}
    DST = dict(SRC)  # all byte-identical — that is why they are candidates
    result = confirm_identical(
        keys=list(SRC), source_flat=SRC, target_flat=DST,
        target_lang="es", ask=ask,
    )
    assert [c["key"] for c in result["cleared"]] == ["common.no"]
    assert result["proposed"] == [{"key": "sidebar.books", "src": "Books", "dst": "Books",
                                   "suggestion": "Libros"}]
    assert [f["key"] for f in result["failed"]] == ["bad.key"]
    assert "engine down" in result["failed"][0]["error"]


def test_attach_confirmations_annotates_live_and_ignores_stale():
    src = {"common.no": "No", "sidebar.books": "Books"}
    dst = dict(src)
    findings = [
        {"key": "common.no", "code": CONFIRM_CODE, "detail": "identical"},
        {"key": "sidebar.books", "code": CONFIRM_CODE, "detail": "identical"},
        {"key": "common.no", "code": "brackets", "detail": "other code untouched"},
    ]
    live_hash = acceptance_hash(key="common.no", code=CONFIRM_CODE, src="No", dst="No")
    verdicts = {
        "common.no": {"hash": live_hash, "verdict": "same", "engine": "e", "suggestion": None},
        # Stale: hashed over strings that have since changed — must be IGNORED, the same
        # expiry an acceptance follows.
        "sidebar.books": {"hash": "0" * 16, "verdict": "translate",
                          "engine": "e", "suggestion": "Libros"},
    }
    out = attach_confirmations(findings, verdicts, src, dst)
    assert out[0]["confirmed"] == "same" and out[0]["confirmedBy"] == "e"
    assert "confirmed" not in out[1], "a stale verdict is retired, not shown"
    assert "confirmed" not in out[2], "other codes are never annotated"
