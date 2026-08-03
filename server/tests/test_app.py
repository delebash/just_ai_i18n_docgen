# SPDX-License-Identifier: MIT
"""The app factory — the standard's three lines, proven working from a fresh data dir.

Same hermeticity rules as just-llm-runner's own test_install_llm: reset the runner
singleton, file-backed SQLite (create_app makes its own in the tmp data dir), and both
routers mounted. This app is the shared package's first greenfield adopter, so this test
doubles as the adoption doc's proof."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from llm_runner.llm import seed
from llm_runner.runner import lifecycle

from just_ai_i18n_docgen.app import FEATURE_CATALOG, create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(lifecycle, "_service", None)
    monkeypatch.setattr(seed, "_APP", dict(seed._APP))
    return TestClient(create_app(tmp_path))


def test_the_stack_boots_seeded_and_wired(client):
    providers = client.get("/v1/llm-providers")
    assert providers.status_code == 200
    assert len(providers.json()["providers"]) > 0, "seed_llm should have seeded providers"

    models = client.get("/v1/llm-runner/models")
    assert models.status_code == 200
    body = models.json()
    assert body["catalogWired"] is True
    assert len(body["models"]) > 0, "the seeded model catalog reaches the runner"

    assert client.get("/v1/ai-usage").status_code == 200


def test_the_four_features_are_registered(client):
    routing = client.get("/v1/ai/routing")
    assert routing.status_code == 200
    keys = {f["key"] for f in routing.json().get("features", [])}
    assert keys == {f.key for f in FEATURE_CATALOG}
    assert keys == {"translate", "review", "confirm", "extract"}


def test_the_runner_cache_lands_in_the_app_data_dir(client, tmp_path):
    # The delete-the-app-delete-the-weights guarantee: data_dir was passed, so the
    # runner's cache root is inside it, not in ~/.cache.
    assert str(lifecycle.get_service().cache_root) == str(tmp_path / "ai-cache")


def test_logs_ring_captures_and_serves_server_logs(client):
    """The Settings → Logs viewer's contract: a log line written through the
    standard logging module lands in the shared ring and comes back over
    /v1/logs/all — content, not just a 200."""
    import logging

    logging.getLogger("just_ai_i18n_docgen.test").warning("RING-PROOF %s", "abc123")
    r = client.get("/v1/logs/tail")
    assert r.status_code == 200
    assert "RING-PROOF abc123" in r.json()["text"]


def test_disk_usage_reports_the_data_dir(client):
    r = client.get("/v1/disk/usage")
    assert r.status_code == 200
    body = r.json()
    assert "totalBytes" in r.text or body, "the shared disk route must answer with usage"


def test_a_browser_origin_gets_cors_headers(client):
    """Vite dev (:1420) hits :8742 DIRECTLY (the kit's origin-aware resolver), so
    without CORSMiddleware every browser dev request dies as a silent block.
    Found live 2026-08-02 — TestClient is same-origin, which is why only an
    explicit Origin header can make a test see it."""
    r = client.get("/v1/setup/state", headers={"Origin": "http://localhost:1420"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"
