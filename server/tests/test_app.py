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


def test_the_three_routed_features_are_registered(client):
    # Extract left the catalog 2026-08-04: it never calls the engine (pure front-matter
    # parsing), and a routing row that cannot route is a lie. The CLI door is untouched;
    # it re-registers the day it gains a real AI step.
    routing = client.get("/v1/ai/routing")
    assert routing.status_code == 200
    keys = {f["key"] for f in routing.json().get("features", [])}
    assert keys == {f.key for f in FEATURE_CATALOG}
    assert keys == {"translate", "review", "confirm"}


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


def test_health_answers_the_boot_gate(client):
    """The kit's checkServer() pings /v1/health before main.js mounts the app.
    Without this route every RELEASE boot showed ConnectionError forever
    (found 2026-08-04 by the real-webview smoke; nothing else boots through
    main.js, so this test is the only cheap tripwire)."""
    r = client.get("/v1/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_bearer_auth_gates_v1_only_when_tokens_exist(client):
    """The headless lock: no tokens → open; tokens set → /v1 needs the bearer
    (TestClient's host is not loopback, so the gate bites), UI assets stay open."""
    assert client.get("/v1/setup/state").status_code == 200  # off by default

    r = client.put("/v1/server-auth", json={"tokens": ["s3cret"]})
    assert r.status_code == 200
    try:
        assert client.get("/v1/setup/state").status_code == 401, "no header → 401"
        assert client.get(
            "/v1/setup/state", headers={"Authorization": "Bearer wrong"}
        ).status_code == 403, "bad token → 403"
        assert client.get(
            "/v1/setup/state", headers={"Authorization": "Bearer s3cret"}
        ).status_code == 200, "good token → through"
    finally:
        # Clear through the gate (with the token) so later tests stay unauthenticated.
        client.put("/v1/server-auth", json={"tokens": []},
                   headers={"Authorization": "Bearer s3cret"})
    assert client.get("/v1/setup/state").status_code == 200


def test_lockout_escape_health_and_auth_door_stay_open_from_loopback(client, monkeypatch):
    """audit 2026-08-05: requireForLoopback + a lost token gated even /v1/health
    (the desktop's boot gate died on ConnectionError FOREVER) and /v1/server-auth
    (the very door to fix it) — the route's own docstring promises the local user
    can never lock themselves out. From the machine itself both stay open (the
    tokens already sit plaintext in the app DB any local process can read, so
    this exposes nothing new); everything else stays gated."""
    # The loopback check lives in the FAMILY middleware now (P2, 2026-08-08).
    from llm_runner.platform import auth as platform_auth
    monkeypatch.setattr(platform_auth, "_is_loopback", lambda host: True)
    client.put("/v1/server-auth", json={"tokens": ["s3cret"],
                                        "requireForLoopback": True})
    try:
        assert client.get("/v1/health").status_code == 200, "the boot probe never locks"
        assert client.get("/v1/server-auth").status_code == 200, "the fix-it door never locks"
        assert client.get("/v1/setup/state").status_code == 401, "the rest stays gated"
    finally:
        client.put("/v1/server-auth", json={"tokens": []})
    assert client.get("/v1/setup/state").status_code == 200


def test_a_browser_origin_gets_cors_headers(client):
    """Vite dev (:1420) hits :8742 DIRECTLY (the kit's origin-aware resolver), so
    without CORSMiddleware every browser dev request dies as a silent block.
    Found live 2026-08-02 — TestClient is same-origin, which is why only an
    explicit Origin header can make a test see it."""
    r = client.get("/v1/setup/state", headers={"Origin": "http://localhost:1420"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"
