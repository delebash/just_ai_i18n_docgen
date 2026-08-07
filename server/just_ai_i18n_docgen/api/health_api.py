# SPDX-License-Identifier: MIT
"""GET /v1/health — the boot-gate contract.

The kit's checkServer() pings /v1/health eight times before main.js mounts the
app; without this route every ping 404'd and the RELEASE webview showed
ConnectionError forever — found 2026-08-04 by the real-webview smoke against
the real project (TestClient and dev never boot through main.js, so no other
gate could see it). The one family payload shape is P6; until then the wire
shape here stays exactly what it was.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..version import PRODUCT

router = APIRouter(tags=["system"])


@router.get("/v1/health")
def health() -> dict:
    return {"ok": True, "product": PRODUCT}
