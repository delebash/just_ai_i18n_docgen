# SPDX-License-Identifier: MIT
"""/v1/prefs — the family renderer-prefs door (target-tree P9).

Pins docgen's storage mapping: `pref.*` rows in app_settings behind the kit
router — the document round-trips, PATCH is wholesale per key, DELETE drops
prefs but never the reviewer row (operator config in the same table)."""

from fastapi.testclient import TestClient

from just_ai_i18n_docgen.app import create_app
from just_ai_i18n_docgen.appmeta import get_reviewer, set_reviewer


def _c(tmp_path):
    return TestClient(create_app(tmp_path))


def test_document_round_trips(tmp_path):
    c = _c(tmp_path)
    assert c.get("/v1/prefs").json() == {}
    merged = c.patch("/v1/prefs", json={"appearance": {"appearance": {"mode": "dark"}}, "keepServerRunning": True}).json()
    assert merged == {"appearance": {"appearance": {"mode": "dark"}}, "keepServerRunning": True}
    assert c.get("/v1/prefs").json() == merged


def test_patch_is_wholesale_per_key(tmp_path):
    c = _c(tmp_path)
    c.patch("/v1/prefs", json={"appearance": {"appearance": {"mode": "dark", "hue": 200}}})
    c.patch("/v1/prefs", json={"appearance": {"appearance": {"mode": "light"}}})
    assert c.get("/v1/prefs").json()["appearance"] == {"appearance": {"mode": "light"}}


def test_delete_clears_prefs_but_never_the_reviewer(tmp_path):
    c = _c(tmp_path)
    set_reviewer("dana")
    c.patch("/v1/prefs", json={"aiOfferShown": True})
    assert c.delete("/v1/prefs").status_code == 204
    assert c.get("/v1/prefs").json() == {}
    assert get_reviewer() == "dana"
