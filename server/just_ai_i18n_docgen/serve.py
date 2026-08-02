# SPDX-License-Identifier: MIT
"""`just-ai-i18n-docgen-server` — run the server standalone (and as the Tauri sidecar)."""

from __future__ import annotations

import argparse

import uvicorn

from .app import PORT, create_app, default_data_dir


def main() -> None:
    ap = argparse.ArgumentParser(description="Just AI i18n & Docgen server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--data-dir", default=None, help=f"default: {default_data_dir()}")
    args = ap.parse_args()
    uvicorn.run(create_app(args.data_dir), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
