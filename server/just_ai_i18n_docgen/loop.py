# SPDX-License-Identifier: MIT
"""The translate loop — Layer 1's orchestration. Owned, on purpose.

Ported from just-ai-help's `server/loop.js` `translateLanguage`, with ONE structural
change: the engine call is an injected `send(system, user) -> str` callable instead of a
transport this module owns. The Node loop existed because owning the request body was the
only cure for a class of invisible request damage; in this rewrite the body is owned by
llm-runner's adapters and the per-feature engine preset — the wiring layer builds `send`
from the resolved "translate" preset, and THAT layer carries the probe's
non-zero-temperature guard (reading the RESOLVED preset, never a constant, for the same
reason effectiveTemperature read the built body).

Everything else ports faithfully, because every rule was paid for:

RETRY LADDER, and the last rung is the important one: batch ×3, then the batch's items as
singletons ×2, then the key is LEFT UNTRANSLATED and reported. Never silently skipped —
that exact bug ("exits 0 even when it skipped keys") is why this project exists.

A key counts as delivered only when every shield token came back exactly once — a
translation that lost a placeholder is a FAILURE routed to retry, not a result.

FLUSH after every batch, not once at the end: a full catalogue is an hour of local
generation, and a crash at minute 55 must not throw away 54 minutes. Both halves are
needed — the cache alone resumes nothing, because the delta skips a key only when the
cache entry AND the existing target value are present, so `on_batch` writes the partial
locale file.

The cache is ALWAYS loaded, even under force: force means "re-translate these keys
anyway", not "throw away what every other key and language already learned".
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path

from .jsonio import placeholder_re
from .shieldlib import (
    build_system_prompt,
    build_user_message,
    cache_key,
    parse_items,
    restore,
    sha1,
    shield,
)


def _load_cache(path: str | Path) -> dict:
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}  # a corrupt cache costs a re-run, never a wrong answer


def translate_language(
    *,
    source_flat: dict[str, str],
    existing_flat: dict[str, str] | None = None,
    lang: str,
    cfg: dict,
    cache_path: str | Path,
    send: Callable[[str, str], str],
    force: bool = False,
    batch_size: int = 16,
    rate_limit_ms: int = 0,
    log: Callable[[str], None] = print,
    on_batch: Callable[[dict], None] | None = None,
    is_cancelled: Callable[[], bool] | None = None,
) -> dict:
    """Translates one language through the injected engine seam.

    Returns {"values": {...}, "failed": [...], "requests": int, "cancelled": bool}.
    Cancellation is checked on batch boundaries, never inside one — a batch in flight has
    been paid for, and stopping on a boundary keeps the same guarantee the crash-resume
    path has: whatever is in `values` is complete and consistent."""
    existing_flat = existing_flat or {}
    ph_re = placeholder_re(cfg["placeholder"])
    context_hash = sha1(cfg.get("context") or "")
    glossary_hash = sha1(json.dumps(cfg.get("glossary") or {}, sort_keys=True))
    terms = (cfg.get("glossary") or {}).get("doNotTranslate") or []
    system = build_system_prompt(
        source=cfg.get("sourceLanguage", "en"),
        target_lang=lang,
        do_not_translate=terms,
        conventions_line=cfg.get("conventionsLine", ""),
        plural_separator=cfg.get("pluralSeparator"),
    )

    cache = _load_cache(cache_path)
    values: dict[str, str] = {}
    todo: list[dict] = []

    for key, text in source_flat.items():
        ck = cache_key(text=text, lang=lang, context_hash=context_hash, glossary_hash=glossary_hash)
        if not force and key in existing_flat and ck in cache:
            values[key] = existing_flat[key]
            continue
        todo.append({"key": key, "text": text, "ck": ck})

    log(f"{lang}: {len(source_flat) - len(todo)} unchanged, {len(todo)} to translate")
    if not todo:
        return {"values": values, "failed": [], "requests": 0, "cancelled": False}

    batches = [todo[i:i + batch_size] for i in range(0, len(todo), batch_size)]
    failed: list[str] = []
    requests = 0
    last_call = 0.0

    def attempt(group: list[dict]) -> list[dict]:
        """Sends one group; returns the items it could not deliver. A key counts as
        delivered only when the shield tokens all came back."""
        nonlocal requests, last_call
        shielded = []
        for i, it in enumerate(group):
            sh, tokens = shield(it["text"], ph_re, terms)
            shielded.append({**it, "i": i, "shielded": sh, "tokens": tokens})
        user = build_user_message(shielded, cfg)

        wait = rate_limit_ms / 1000 - (time.monotonic() - last_call)
        if wait > 0:
            time.sleep(wait)
        last_call = time.monotonic()
        requests += 1

        items = parse_items(send(system, user))

        still_missing = []
        for s in shielded:
            raw = items.get(s["i"])
            restored = None if raw is None else restore(raw, s["tokens"])
            if restored is None or not restored.strip():
                still_missing.append(s)
            else:
                values[s["key"]] = restored
                cache[s["ck"]] = restored
        return still_missing

    for bi, batch in enumerate(batches):
        if is_cancelled and is_cancelled():
            log(f"  {lang}: cancelled after {bi} of {len(batches)} batch(es)")
            return {"values": values, "failed": failed, "requests": requests, "cancelled": True}

        pending: list[dict] = batch
        for try_no in range(1, 4):
            if not pending:
                break
            try:
                pending = attempt(pending)
                if pending:
                    log(f"  batch {bi + 1}: {len(pending)} item(s) unresolved, retry {try_no}/3")
            except Exception as err:  # noqa: BLE001 — an engine error is data for the ladder
                log(f"  batch {bi + 1}: {err} (attempt {try_no}/3)")
                if try_no == 3:
                    break
                time.sleep(try_no)

        # Singletons: a batch that keeps failing is usually ONE pathological string, and
        # sending it alone both isolates it and gives the model the whole budget for it.
        for item in pending:
            done = False
            for try_no in range(1, 3):
                if done:
                    break
                try:
                    done = len(attempt([item])) == 0
                except Exception as err:  # noqa: BLE001
                    log(f"  {item['key']}: {err} (singleton {try_no}/2)")
            if not done:
                failed.append(item["key"])

        Path(cache_path).write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")
        if on_batch:
            on_batch(values)
        log(f"  {lang}: {len(values)}/{len(source_flat)} done (batch {bi + 1}/{len(batches)})")

    return {"values": values, "failed": failed, "requests": requests, "cancelled": False}
