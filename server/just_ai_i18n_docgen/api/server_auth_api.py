# SPDX-License-Identifier: MIT
"""GET/PUT /v1/server-auth — the headless lock (Settings → Server).

Bearer tokens gating /v1/* when the server runs exposed. Off (empty) by
default; reading/writing this endpoint is itself gated once tokens exist —
loopback stays exempt unless requireForLoopback is set, so the local user can
never lock themselves out (the kit's BearerAuthMiddleware leaves /v1/health
and THIS route reachable from loopback — the lockout escape).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from .. import appmeta
from ..auth import read_auth

router = APIRouter(tags=["system"])


@router.get("/v1/server-auth")
def get_server_auth() -> dict:
    tokens, require = read_auth()
    return {"tokens": tokens, "requireForLoopback": require}


@router.put("/v1/server-auth")
def put_server_auth(body: dict) -> dict:
    tokens = body.get("tokens")
    if not isinstance(tokens, list) or not all(isinstance(t, str) for t in tokens):
        raise HTTPException(400, "tokens must be a list of strings")
    cfg = {"tokens": [t for t in tokens if t.strip()],
           "requireForLoopback": bool(body.get("requireForLoopback"))}
    appmeta.set_setting("auth", json.dumps(cfg))
    return cfg
