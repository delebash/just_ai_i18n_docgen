# SPDX-License-Identifier: MIT
"""CSRF Origin guard (csrf.py) — the no-token "do the vector directly" hardening.

JW's test_csrf.py is the donor. Assertions are framed as "the middleware did /
did not block" (403 vs anything-else) so they stay true whatever the route
itself answers about workspace state.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from llm_runner.llm import seed
from llm_runner.runner import lifecycle

from just_ai_i18n_docgen.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(lifecycle, "_service", None)
    monkeypatch.setattr(seed, "_APP", dict(seed._APP))
    return TestClient(create_app(tmp_path))


def test_cross_site_mutation_rejected(client):
    # A malicious page's cross-site mutating request is rejected (the CSRF
    # vector) — before routing, so the path's own semantics never matter.
    r = client.post("/v1/undo", json={}, headers={"origin": "http://evil.example"})
    assert r.status_code == 403
    assert r.json()["type"].endswith("/cross-origin")


def test_no_origin_and_app_origin_allowed(client):
    # No Origin (the CLI / curl / tests) → not blocked by CSRF.
    assert client.post("/v1/undo", json={}).status_code != 403
    # The app's own dev origin (Vite :1420) → not blocked.
    assert client.post("/v1/undo", json={},
                       headers={"origin": "http://localhost:1420"}).status_code != 403


def test_same_origin_mutation_allowed(client):
    """The server-hosted UI is same-origin, and browsers DO send Origin on
    same-origin mutations (JW hit exactly that, 2026-07-15). Derived
    per-request, so any host/port works."""
    r = client.post("/v1/undo", json={}, headers={"origin": "http://testserver"})
    assert r.status_code != 403


def test_cross_site_read_allowed(client):
    # GET is not the CSRF vector.
    r = client.get("/v1/health", headers={"origin": "http://evil.example"})
    assert r.status_code == 200
