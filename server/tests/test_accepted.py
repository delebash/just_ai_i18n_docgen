# SPDX-License-Identifier: MIT
"""Accepted findings — ported from just-ai-help's `test/accepted.test.js`. The
load-bearing tests are not "an acceptance is quiet" — they are the three ways an
acceptance must EXPIRE, because a mechanism never seen to STOP suppressing is
indistinguishable from one that suppresses forever."""

from __future__ import annotations

import json
import re

from just_ai_i18n_docgen.accepted import (
    UNKNOWN_REVIEWER,
    acceptance_entry,
    acceptance_hash,
    load_accepted,
    partition_accepted,
    save_accepted,
)

SRC = {"common.no": "No"}
DST = {"common.no": "No"}
FINDING = [{"key": "common.no", "code": "untranslated", "detail": "identical to the source string"}]


def accept(findings, source_flat, target_flat):
    store = {}
    for f in findings:
        entry = acceptance_entry(
            key=f["key"], code=f["code"],
            src=source_flat[f["key"]], dst=target_flat[f["key"]],
        )
        store[acceptance_hash(key=entry["key"], code=entry["code"],
                              src=entry["src"], dst=entry["dst"])] = entry
    return store


def test_an_accepted_finding_stops_counting_but_is_still_returned_never_dropped():
    store = accept(FINDING, SRC, DST)
    findings, accepted = partition_accepted(FINDING, store, SRC, DST)
    assert findings == []
    # The caller can always report it. A suppression the reader cannot see is the bug
    # this project was written in response to.
    assert len(accepted) == 1
    assert accepted[0]["key"] == "common.no"


def test_bites_changing_the_source_revives_the_acceptance():
    # "No" -> "No" is correct Spanish; "No chapters" -> "No chapters" is a skipped
    # string, and a standing per-key exemption would have hidden it forever.
    store = accept(FINDING, SRC, DST)
    findings, accepted = partition_accepted(FINDING, store, {"common.no": "No chapters"}, DST)
    assert len(findings) == 1, "a changed source must come back as a finding"
    assert accepted == []


def test_bites_editing_the_target_revives_the_acceptance():
    store = accept(FINDING, SRC, DST)
    findings, _ = partition_accepted(FINDING, store, SRC, {"common.no": "Nope"})
    assert len(findings) == 1, "an edited target must come back as a finding"


def test_bites_accepting_one_code_does_not_hide_a_different_code_on_the_same_key():
    src = {"a.k": "Headless access"}
    dst = {"a.k": "Acceso sin interfaz (headless)"}
    brackets = [{"key": "a.k", "code": "brackets", "detail": "…"}]
    store = accept(brackets, src, dst)

    both = [*brackets, {"key": "a.k", "code": "placeholder-changed", "detail": "…"}]
    findings, accepted = partition_accepted(both, store, src, dst)
    assert [f["code"] for f in findings] == ["placeholder-changed"]
    assert [f["code"] for f in accepted] == ["brackets"]


def test_the_hash_separates_fields_that_would_otherwise_concatenate_the_same():
    # key "a|b" + code "c" must not collide with key "a" + code "b|c".
    a = acceptance_hash(key="a|b", code="c", src="x", dst="y")
    b = acceptance_hash(key="a", code="b|c", src="x", dst="y")
    assert a != b
    assert a == acceptance_hash(key="a|b", code="c", src="x", dst="y"), "and it is stable"


def test_the_accepted_file_round_trips_and_holds_data_only(tmp_path):
    path = tmp_path / "es.accepted.json"
    save_accepted(path, accept(FINDING, SRC, DST))

    on_disk = json.loads(path.read_text(encoding="utf-8"))
    # JSON is for parsers — no prose, no metadata keys.
    assert not any(k.startswith("_") for k in on_disk)
    entry = next(v for v in on_disk.values() if isinstance(v, dict))
    assert entry["key"] == "common.no"
    assert entry["code"] == "untranslated"
    assert entry["src"] == "No" and entry["dst"] == "No"
    # Provenance: an unclaimed verdict says so rather than borrowing a name.
    assert entry["by"] == UNKNOWN_REVIEWER
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry["at"])

    loaded = load_accepted(path)
    assert partition_accepted(FINDING, loaded, SRC, DST)[0] == []


def test_a_corrupt_or_missing_sidecar_costs_a_re_review_never_a_wrong_pass(tmp_path):
    assert load_accepted(tmp_path / "nope.json") == {}
    bad = tmp_path / "es.accepted.json"
    bad.write_text("{ not json", encoding="utf-8")
    assert load_accepted(bad) == {}
    # Fails toward showing the finding, which is the only safe direction.
    assert len(partition_accepted(FINDING, load_accepted(bad), SRC, DST)[0]) == 1


def test_underscore_keys_are_skipped_on_read(tmp_path):
    path = tmp_path / "es.accepted.json"
    store = accept(FINDING, SRC, DST)
    path.write_text(json.dumps({**store, "_why": "old prose"}), encoding="utf-8")
    assert len(load_accepted(path)) == 1, "_why must not be read back as an acceptance"
