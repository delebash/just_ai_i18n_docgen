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
