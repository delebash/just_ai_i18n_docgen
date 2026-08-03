# SPDX-License-Identifier: MIT
"""Bearer-token authentication middleware — JW's auth.py, storage seam adapted.

Headless serving is a first-class way to run this server (the design point, user-
confirmed 2026-08-03) — and running exposed needs a lock. OFF by default: an empty
token list means no auth (the normal local-loopback case). Policy, uniform with
JW/JV:
  - no tokens                                    → no auth required
  - tokens + loopback + not require_for_loopback → loopback bypasses auth
  - otherwise                                    → every /v1/* request needs
                                                   `Authorization: Bearer <token>`

Config lives in the app's own settings table (appmeta, key "auth":
`{"tokens": [...], "requireForLoopback": bool}`) — read per /v1 request so a
change applies live; asset/UI requests skip the gate entirely so the headless
browser can always load the app and log in.
"""

from __future__ import annotations

import ipaddress
import json
import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger(__name__)


def _is_loopback(host: str) -> bool:
    if host in ("127.0.0.1", "::1", "localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def read_auth() -> tuple[list[str], bool]:
    """(tokens, require_for_loopback) from appmeta's `auth` row. Defaults to no
    auth on any read error so a settings glitch can't lock the user out."""
    from . import appmeta

    try:
        raw = appmeta.get_setting("auth")
        if not raw:
            return [], False
        cfg = json.loads(raw) or {}
        tokens = [t for t in (cfg.get("tokens") or []) if isinstance(t, str) and t]
        return tokens, bool(cfg.get("requireForLoopback"))
    except Exception as e:  # noqa: BLE001 — never let an auth-config read 500
        log.warning("auth config read failed (treating as no-auth): %s", e)
        return [], False


def _problem(status: int, slug: str, title: str, detail: str, path: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "type": f"https://just-ai-i18n-docgen.dev/errors/{slug}",
            "title": title,
            "status": status,
            "detail": detail,
            "instance": path,
        },
        media_type="application/problem+json",
    )


class BearerAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Only gate the API. UI assets, docs, openapi, and the static mount
        # always pass (so the headless browser can load the app + log in).
        if not path.startswith("/v1"):
            return await call_next(request)

        tokens, require_for_loopback = read_auth()
        if not tokens:
            return await call_next(request)

        client_host = request.client.host if request.client else ""
        if _is_loopback(client_host) and not require_for_loopback:
            return await call_next(request)

        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            return _problem(401, "unauthorized", "Unauthorized",
                            "Authorization header missing or malformed", path)
        token = header[len("Bearer "):].strip()
        if token not in tokens:
            return _problem(403, "forbidden", "Forbidden",
                            "Bearer token not accepted", path)
        return await call_next(request)
