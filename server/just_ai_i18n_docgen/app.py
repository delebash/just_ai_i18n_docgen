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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from llm_runner.llm import install_llm, load_from_configs, stores
from llm_runner.llm.routing_api import FeatureCatalogEntry
from llm_runner.llm.seed import seed_llm
from llm_runner.platform import (
    install_file_log,
    install_log_ring,
    make_disk_router,
    make_logs_router,
)
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

# The app's OWN model catalog — TRANSLATION-measured rows only, ranked by the measured
# table (just-ai-help/docs/models.md; the 40-key stress corpus + the 1,965-key live
# run). The runner's DEFAULT_CATALOG is writing-curated (StyleTune tunes, embeds,
# writing ranks) and is SUPPRESSED for this app (`seed_default_model_catalog=False`) —
# "the models are all JW" was a live user finding, 2026-08-03. No embedding rows: this
# app has no embedding features. Field shapes mirror the audited family rows;
# license/ctx values follow the family's audited pattern for the same repos — re-run
# the seed-facts audit (network) whenever these rows change.
MODEL_CATALOG: list[dict] = [
    {"id": "gemma-4-26b-a4b-qat-xl", "name": "Gemma 4 26B-A4B (QAT)",
     "hf_repo": "unsloth/gemma-4-26B-A4B-it-qat-GGUF", "quant": "UD-Q4_K_XL",
     "total_params": "26B", "active_params": "4B", "type": "moe",
     "mtp": True, "mtp_draft_repo": "unsloth/gemma-4-26B-A4B-it-qat-GGUF",
     "mtp_draft_file": "MTP/mtp-gemma-4-26B-A4B-it-Q4_0.gguf", "mtp_draft_quant": "Q4_0",
     "trained_ctx": 262144, "samplers": {"top_k": "64", "top_p": "0.95", "temperature": "1"},
     "min_vram_mb": 4096, "min_ram_mb": 24576, "tier": "low-vram-moe",
     "license": "Apache-2.0", "position": 0, "quality_rank": 1,
     "architecture": "gemma4", "experts": 128,
     "description": "26B MoE (4B active) · 256k context · the MEASURED flagship: most "
                    "accurate AND fastest on the stress corpus and the 1,965-key live run",
     "notes": "The default pick when it fits (needs ~24 GB RAM for expert offload)."},
    {"id": "gemma-3-12b-it", "name": "Gemma 3 12B",
     "hf_repo": "unsloth/gemma-3-12b-it-GGUF", "quant": "Q4_K_M",
     "total_params": "12B", "type": "dense",
     "trained_ctx": 131072, "samplers": {"top_k": "64", "top_p": "0.95", "temperature": "1"},
     "min_vram_mb": 8192, "min_ram_mb": 12288, "tier": "mid",
     "license": "Gemma", "position": 1, "quality_rank": 2,
     "architecture": "gemma3", "experts": 0,
     "description": "12B dense · MEASURED: 0 structural, 1 semantic flag, zero real "
                    "errors on the stress corpus",
     "notes": "The clean 8 GB-card pick."},
    {"id": "hy-mt2-7b", "name": "Hunyuan-MT2 7B (translation-tuned)",
     "hf_repo": "tencent/Hy-MT2-7B-GGUF", "quant": "Q4_K_M",
     "total_params": "7B", "type": "dense",
     "trained_ctx": 32768,
     "min_vram_mb": 6144, "min_ram_mb": 8192, "tier": "small",
     "license": "tencent-hunyuan-community", "position": 2, "quality_rank": 3,
     "architecture": "hunyuan", "experts": 0,
     "description": "7B translation-tuned · MEASURED: 0 structural, 3 semantic flags",
     "notes": "Small and fast. Caveat, measured: the family can drop Spanish opening "
              "¿ — keep the checks on."},
]


def default_data_dir() -> Path:
    """JW parity: the desktop shell resolves the (portable) data root and hands it to
    the server via the env var — same contract as JUSTWRITE_DATA_DIR. A CLI flag still
    wins; the OS app-data dir is the no-shell fallback."""
    import os

    env = os.environ.get("JUST_AI_I18N_DOCGEN_DATA_DIR")
    if env:
        return Path(env)
    return Path(user_data_dir("just-ai-i18n-docgen", appauthor=False))


def boot_llm_stack(data_dir: Path | None = None, app: FastAPI | None = None) -> Path:
    """The stack WITHOUT the routes — storage, seed, registry, the app's own table.

    Split from create_app because the CLI needs it too: `make_send` resolves presets
    through the shared stores, which do not exist until storage is configured. The CLI
    calling service functions with no boot died at "LLM storage not configured" — found
    by the E2E, exactly the class of gap it exists to find. When `app` is given, the
    routers are mounted as well (create_app's path)."""
    data_dir = Path(data_dir) if data_dir else default_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    engine = create_engine(f"sqlite:///{data_dir / 'app.db'}")
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    if app is not None:
        # The standard (just-llm-runner README, "Consume it"): the host mounts the
        # runner's process API, install_llm mounts the rest — JW's exact order.
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
            model_catalog_extra=MODEL_CATALOG,
            seed_default_model_catalog=False,  # translation-measured rows ONLY
            data_dir=data_dir,
            # Names this app in the family cache registry, so the NEXT app installed
            # can offer to share these engine + model files instead of re-downloading.
            product=PRODUCT,
        )
    else:
        # Routeless boot — the CLI door. install_llm(app=None) is first-class in the
        # shared package now (2026-08-02): same storage/seed/wiring path, no routes.
        # (This block used to re-implement that half against PRIVATE imports — the
        # exact drift class the shared package exists to prevent; the overnight
        # re-review sent the capability upstream instead.)
        install_llm(
            None,
            engine=engine,
            session_factory=session_factory,
            feature_catalog=FEATURE_CATALOG,
            feature_prompts={},
            engine_presets=DEFAULT_ENGINE_PRESETS,
            feature_presets=DEFAULT_FEATURE_PRESETS,
            default_preset_id=DEFAULT_PRESET_ID,
            model_catalog_extra=MODEL_CATALOG,
            seed_default_model_catalog=False,
            data_dir=data_dir,
            product=PRODUCT,
        )

    seed_llm()
    load_from_configs(stores.get_provider_store().list())

    # The app's OWN table (reviewer identity) on its OWN Base — one database, two
    # Bases, the documented family pattern.
    from .appmeta import configure_app_storage

    configure_app_storage(session_factory, engine)
    return data_dir


def create_app(data_dir: Path | None = None,
               config_path: str | Path | None = None) -> FastAPI:
    data_dir = Path(data_dir) if data_dir else default_data_dir()

    # Server logs → in-memory ring (the Settings → Logs viewer) + a rotating file
    # that survives a crash/boot-hang. Shared platform helpers, same in every app
    # (JW parity — the app shipped without ANY log surface until 2026-08-03).
    install_log_ring()
    install_file_log(data_dir / "logs" / "just-ai-i18n-docgen.log")

    app = FastAPI(title=PRODUCT, version="0.1.0")

    # Catch-all error envelope — registered BEFORE CORSMiddleware so an unhandled
    # exception becomes a JSON 500 that flows OUT through CORS and reaches the
    # browser as a real error (a bare exception runs in Starlette's
    # ServerErrorMiddleware, OUTSIDE CORS, so the browser would see a CORS block
    # instead). JW parity — verified the hard way in JV, 2026-06-12.
    @app.middleware("http")
    async def _error_envelope(request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:
            log.exception("unhandled error on %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=500,
                content={"title": "Internal Server Error", "detail": str(exc)[:300]},
            )

    # Bearer auth — OFF unless tokens are configured (Settings → Server). Gates
    # /v1/* only. Added BEFORE CORS so CORS ends up OUTERMOST (Starlette runs
    # last-added first): CORS answers preflights before auth sees them, and
    # wraps auth's 401/403 with CORS headers. JW's exact ordering.
    from .auth import BearerAuthMiddleware

    app.add_middleware(BearerAuthMiddleware)

    # CORS — allow-all, JW's local + dev + headless fallback: the kit's
    # origin-aware resolver hits :8742 DIRECTLY from Vite dev (:1420), so without
    # this every dev request dies as a silent CORS block (found live 2026-08-02 —
    # no test can see it: TestClient is same-origin). A loopback server for one
    # user; JW's settings-driven origin lockdown can come with a settings surface.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    boot_llm_stack(data_dir, app=app)

    # Shared platform surfaces (JW's exact wiring): the log ring's API and the
    # read-only disk-usage route the Settings → Storage panel reads.
    app.include_router(make_logs_router(PRODUCT))
    app.include_router(make_disk_router(data_dir))

    # The review workspace: starts with NO project (the setup screen creates one);
    # `config_path` pre-loads one for the CLI / a configured desktop launch.
    from .workspace import Workspace, make_workspace_router

    workspace = Workspace(config_path)
    app.include_router(make_workspace_router(workspace))
    app.state.workspace = workspace  # the test/CLI handle, follows a later setup-load

    # Headless UI — serve the Vite build so `just-ai-i18n-docgen-server` + a browser
    # gives the full app WITHOUT the Tauri shell (the kit's origin-aware serverApi
    # targets window.location.origin). Uniform with JW/JV. Mounted LAST so every
    # /v1/* route wins first.
    dist = Path(__file__).resolve().parent.parent.parent / "dist"
    if dist.is_dir():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=dist, html=True), name="ui")

    return app
