# SPDX-License-Identifier: MIT
"""Long runs, and the three things a reviewer needs from one.

Ported from just-ai-help's `server/jobs.js`. A full catalogue is ~52 minutes on the
shipped local model, which rules out a POST that translates and then responds. A run is
a JOB — started, streamed, cancellable, and rejoinable after a reload.

THREE RULES, each of which is a test:
  1. A job writes ONLY proposals. The locale file is byte-identical when it finishes.
  2. ONE job at a time. A second start raises JOB_BUSY (the 409). Two concurrent runs
     would both write proposals for overlapping keys and the loser's work would vanish
     silently — the exact bug class this project exists to prevent.
  3. Cancelling loses nothing: it stops on a batch boundary, keeps every proposal
     already staged, and leaves the catalogue untouched.

Subscribers are plain callbacks; the workspace router adapts them to SSE. Keeping
transport out of here is what lets the tests drive a whole job without a socket.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable

from .loop import translate_language
from .state import JsonStore, finish_run, put_proposal, start_run

_TERMINAL = {"done", "cancelled", "failed"}


class JobBusyError(RuntimeError):
    pass


class JobManager:
    def __init__(self, *, store: JsonStore | None = None, log: Callable = lambda _m: None):
        self.store = store
        self.log = log
        self.current: dict | None = None
        self._subs: list[Callable] = []
        self._lock = threading.Lock()

    def status(self) -> dict | None:
        """What a reloaded page asks for, so it can rejoin a run it did not start."""
        j = self.current
        if j is None:
            return None
        return {k: (list(j[k]) if k == "failed" else j[k])
                for k in ("id", "lang", "engine", "scope", "total", "done",
                          "requests", "startedAt", "state", "error", "failed")}

    @property
    def busy(self) -> bool:
        return self.current is not None and self.current["state"] not in _TERMINAL

    def subscribe(self, fn: Callable) -> Callable:
        with self._lock:
            self._subs.append(fn)

        def off():
            with self._lock:
                if fn in self._subs:
                    self._subs.remove(fn)
        return off

    def _emit(self, type_: str, data: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for fn in subs:
            fn({"type": type_, **data})

    def start(self, *, lang: str, engine: str, send: Callable, scope: str, subset: dict,
              cfg: dict, cache_path, translate: Callable = translate_language) -> dict:
        """Starts a run over `subset` and stages every result as a proposal. Returns
        immediately — which is what makes the endpoint a 202 rather than a 50-minute
        hang. `translate` is injectable so tests drive the whole lifecycle — progress,
        cancel, failure, rejoin — without an engine."""
        if self.busy:
            raise JobBusyError("a job is already running")

        run_id = start_run(self.store, lang=lang, engine=engine, scope=scope) if self.store else None
        job = {
            "id": f"job-{uuid.uuid4().hex[:12]}",
            "runId": run_id,
            "lang": lang, "engine": engine, "scope": scope,
            "total": len(subset), "done": 0, "requests": 0, "failed": [],
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "startedMs": time.monotonic(),
            "state": "running", "error": None,
            "cancelled": threading.Event(),
        }
        self.current = job
        self._emit("start", {"job": self.status()})

        job["thread"] = threading.Thread(
            target=self._run, args=(job,),
            kwargs={"send": send, "subset": subset, "cfg": cfg,
                    "cache_path": cache_path, "translate": translate},
            daemon=True, name=f"jah-job-{lang}",
        )
        job["thread"].start()
        return self.status()

    def _run(self, job: dict, *, send, subset, cfg, cache_path, translate) -> None:
        seen: set[str] = set()

        def stage(partial: dict) -> None:
            """Called after every batch. Staging here rather than at the end is what
            lets a reviewer start work while the run continues, and what makes a cancel
            keep the work already done."""
            for key, value in partial.items():
                if key in seen:
                    continue
                seen.add(key)
                if self.store:
                    put_proposal(self.store, lang=job["lang"], key=key,
                                 engine=job["engine"], value=value)
                self._emit("item", {"key": key, "value": value, "lang": job["lang"],
                                    "engine": job["engine"]})
            job["done"] = len(seen)
            self._emit("progress", {"done": job["done"], "total": job["total"]})

        try:
            result = translate(
                source_flat=subset, existing_flat={}, lang=job["lang"], cfg=cfg,
                cache_path=cache_path, send=send, force=True, log=self.log,
                is_cancelled=job["cancelled"].is_set, on_batch=stage,
            )
            # The final flush: on_batch fires per batch, but the values are also
            # returned, and a run of one short batch would otherwise stage nothing.
            stage(result["values"])
            job["requests"] = result["requests"]
            job["failed"] = result["failed"]
            job["state"] = "cancelled" if result.get("cancelled") else "done"
        except Exception as err:  # noqa: BLE001 — a dead engine is a job outcome
            job["state"] = "failed"
            job["error"] = str(err)
            self._emit("error", {"message": str(err)})
        finally:
            if self.store and job["runId"]:
                finish_run(self.store, job["runId"], keys=job["done"],
                           requests=job["requests"],
                           elapsed_ms=int((time.monotonic() - job["startedMs"]) * 1000),
                           failed=len(job["failed"]))
            # Named by key, never swallowed — a run that could not deliver a key says
            # which one. The silent-skip bug is the reason this project exists.
            self._emit("done", {"job": self.status()})

    def cancel(self) -> dict | None:
        """Stops after the batch in flight. Everything already staged stays staged."""
        if not self.busy:
            return None
        self.current["cancelled"].set()
        self._emit("cancelling", {"id": self.current["id"]})
        return self.status()

    def settled(self, timeout: float = 30) -> dict | None:
        """Waits for the active run — tests only; nothing in the server blocks on a job."""
        t = self.current.get("thread") if self.current else None
        if t:
            t.join(timeout)
        return self.status()
