# SPDX-License-Identifier: MIT
"""`just-ai-i18n-docgen-server` — run the server standalone (and as the Tauri sidecar)."""

from __future__ import annotations

import argparse

import uvicorn

from .app import create_app, default_data_dir
from .version import DEFAULT_PORT


def main() -> None:
    ap = argparse.ArgumentParser(description="Just AI i18n & DocGen server")
    # JW parity: `just-ai-i18n-docgen-server serve` is the canonical form (the shell
    # and npm scripts use it); the bare form still works.
    ap.add_argument("command", nargs="?", choices=["serve"], default="serve")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--data-dir", default=None, help=f"default: {default_data_dir()}")
    ap.add_argument("--config", default=None,
                    help="pre-load a project config (else use the setup screen)")
    args = ap.parse_args()
    app = create_app(args.data_dir, config_path=args.config)

    # Data seeding lives HERE, not in create_app(): the pytest suite's
    # create_app(tmp_path) apps start unseeded (the family call-site,
    # target-tree P6).
    from .app import seed_llm_stack

    seed_llm_stack()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
