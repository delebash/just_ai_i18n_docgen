# SPDX-License-Identifier: MIT
"""FastAPI application factory — the standard, three lines of wiring.

The Python rewrite of just-ai-help, embedding the shared LLM stack the way every family
app does (JW, JV): mount `llm_runner.router`, call `install_llm`, seed. The engine half
of the old Node tool — settings.js, engine.js, engines.json, all hardware/model
selection — does not exist here, because llm-runner owns all of it.

The four FEATURES are this tool's actions, registered with the shared routing surface so
each one points at an engine preset that owns provider+model+temperature/think:

    translate — the batch loop (the old `translate.js`)
    review    — back-translation + the confirmation pass (`confirm.js`)
    extract   — docs front-matter → locale keys (`extract.js`)
    confirm   — the second-opinion pass on byte-identical targets

`feature_prompts={}` is DELIBERATE and load-bearing: this tool builds its own prompts
(shielding is a substitution — see shieldlib.py) and dispatches directly. The shared
prompt store never carries them.

What stays JSON, per the 2026-08-01 ruling: `config.json`, `<lang>.accepted.json`,
`<lang>.notes.json` — they belong to the app being translated and live in ITS repo.
Machine state (providers, keys, presets, tunes, usage) lives in the shared DB here.
"""

from __future__ import annotations

import logging
from pathlib import Path

import llm_runner
from fastapi import FastAPI
from llm_runner.llm import install_llm, load_from_configs, stores
from llm_runner.llm.routing_api import FeatureCatalogEntry
from llm_runner.llm.seed import seed_llm
from platformdirs import user_data_dir
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

log = logging.getLogger(__name__)

PRODUCT = "Just AI i18n & Docgen"
PORT = 8742  # JW 17495, JV 8741

FEATURE_CATALOG: list[FeatureCatalogEntry] = [
    FeatureCatalogEntry(key="translate", label="Translate",
                        hint="The batch translate loop — shield, send, restore, check.",
                        group="i18n"),
    FeatureCatalogEntry(key="review", label="Review",
                        hint="Back-translation shown to the reviewer; never written to a catalogue.",
                        group="i18n"),
    FeatureCatalogEntry(key="confirm", label="Confirm",
                        hint="The second opinion on byte-identical targets — annotates, never signs off.",
                        group="i18n"),
    FeatureCatalogEntry(key="extract", label="Extract",
                        hint="Help-doc front-matter → locale keys.",
                        group="docs"),
]

# The engine presets — one-source: the preset owns provider+model+every tunable, and
# each feature points at one (JW's model, seed shape included). Temperature 0.2 is the
# Node loop's MEASURED constant carried over: low enough for consistency, high enough
# that the probe's two passes can disagree — the probe guard reads this value from the
# resolved preset (engine.py) and refuses at 0. `model: ""` = the provider's default
# model; insert-if-missing, so a user's Lab edits are never clobbered by a reseed.
DEFAULT_ENGINE_PRESETS: list[dict] = [
    {"id": "p_translate", "name": "Translate", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.2, "position": 0, "think": False},
    # The confirmation pass asks about byte-identical keys; same profile, its own preset
    # so escalating or re-pointing one never silently moves the other.
    {"id": "p_confirm", "name": "Confirm", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.2, "position": 1, "think": False},
]

DEFAULT_FEATURE_PRESETS: dict[str, str] = {
    "translate": "p_translate",
    "review": "p_translate",   # back-translation: same engine the translation used
    "confirm": "p_confirm",
    "extract": "p_translate",
}

DEFAULT_PRESET_ID: str = "p_translate"


def default_data_dir() -> Path:
    return Path(user_data_dir("just-ai-i18n-docgen", appauthor=False))


def create_app(data_dir: Path | None = None) -> FastAPI:
    data_dir = Path(data_dir) if data_dir else default_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    engine = create_engine(f"sqlite:///{data_dir / 'app.db'}")
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    app = FastAPI(title=PRODUCT, version="0.1.0")

    # The standard (just-llm-runner README, "Consume it"): the host mounts the runner's
    # process API, install_llm mounts the rest, seed_llm fills the defaults, and the
    # registry boots from the DB store — JW's exact order.
    app.include_router(llm_runner.router)
    install_llm(
        app,
        engine=engine,
        session_factory=session_factory,
        feature_catalog=FEATURE_CATALOG,
        feature_prompts={},  # prompts are OURS — see the module docstring
        engine_presets=DEFAULT_ENGINE_PRESETS,
        feature_presets=DEFAULT_FEATURE_PRESETS,
        default_preset_id=DEFAULT_PRESET_ID,
        data_dir=data_dir,
    )
    seed_llm()
    load_from_configs(stores.get_provider_store().list())

    return app
