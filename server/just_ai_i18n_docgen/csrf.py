# SPDX-License-Identifier: MIT
"""CSRF hardening — reject cross-site browser requests to the mutating API.

JustWrite's csrf.py is the donor (its docstring records the user's deciding
factor: "prefer not locking anyone out, do the vector directly"). The server is
a localhost sidecar with allow-all CORS (app.py — the price of shipping no
Tauri HTTP plugin), so before this middleware ANY web page in the user's
browser could mutate :8742 while the app ran. This rejects a MUTATING `/v1`
request whose `Origin` marks it cross-site, UNLESS the origin is the app's own.
It needs NO token, so it can never lock a user out; the only failure mode is a
missing app origin blocking the app itself — which the e2e suite catches.

Allowed:
- no `Origin` header — non-browser clients (the CLI, curl, tests);
- SAME-ORIGIN — the `Origin` equals the server's own origin, derived
  per-request from the URL so any host/port works (the headless mode:
  `just-ai-i18n-docgen-server serve` + a browser on the dist mount — browsers
  DO send Origin on same-origin mutations; JW hit exactly that, 2026-07-15);
- an `Origin` in the app allowlist (the dev + Tauri origins below);
- any non-mutating method (GET/HEAD/OPTIONS) — not the CSRF vector.
Rejected: a mutating `/v1` request carrying any other browser origin → 403.

With this in place the family posture is uniform: JW settings-CORS + CSRF,
JV settings-CORS + CSRF, docgen allow-all CORS + CSRF — mutations are
origin-gated in all three.
"""

from __future__ import annotations

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# The app's own front-end origins: the Vite dev server (:1420) + the packaged
# Tauri webview origins (which normally send no Origin at all — this webview
# fetches DIRECTLY, no HTTP plugin, so the tauri origins here are load-bearing,
# not belt-and-suspenders as in JW).
_APP_ORIGINS = frozenset({
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
})

_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class CsrfOriginMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, extra_origins=()):
        super().__init__(app)
        self._allow = _APP_ORIGINS | frozenset(o for o in (extra_origins or ()) if o)

    def _same_origin(self, request) -> str:
        """The server's OWN origin for this request (scheme://host[:port]) — a
        page we served ourselves. Read from the URL so it follows whatever
        host/port the server actually runs on (8742, a test port, a LAN bind)."""
        return f"{request.url.scheme}://{request.url.netloc}"

    async def dispatch(self, request, call_next):
        if request.method in _MUTATING and request.url.path.startswith("/v1"):
            origin = request.headers.get("origin")
            if origin and origin not in self._allow and origin != self._same_origin(request):
                return JSONResponse(
                    status_code=403,
                    content={
                        "type": "https://just-ai-i18n-docgen.dev/errors/cross-origin",
                        "title": "Forbidden",
                        "status": 403,
                        "detail": "cross-origin request rejected",
                        "instance": request.url.path,
                    },
                    media_type="application/problem+json",
                )
        return await call_next(request)
