# SPDX-License-Identifier: MIT
"""App-owned settings — the host's OWN domain table, on its OWN Base.

The family pattern (llm-runner's db.py documents it): the shared stack owns the LLM
tables; the host "has its own domain tables on its own Base" and shares the engine.
Two kinds of rows live here:

- Machine-level facts, one so far: the REVIEWER's name — asked for once, stamped on
  every acceptance, so a verdict can say who made it. Never the OS username: an
  automated run under a developer's account would inherit it and become
  indistinguishable from that developer's judgement, which is the exact failure the
  field exists to expose.
- Renderer prefs (target-tree P9): `pref.<key>` rows, JSON-encoded, behind the kit's
  `/v1/prefs` router — appearance and the ui flags left localStorage so they ride
  `app.db` (and therefore the shared /v1/data backup/restore/reset). The prefs clear
  drops only `pref.*` rows — the reviewer is operator config and stays.
"""

from __future__ import annotations

from sqlalchemy import Column, String
from sqlalchemy.orm import declarative_base

AppBase = declarative_base()

_session_factory = None


class AppSetting(AppBase):
    __tablename__ = "app_settings"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=True)


def configure_app_storage(session_factory, engine) -> None:
    """Called once from create_app, with the same engine install_llm uses — one
    database, two Bases, the documented pattern."""
    global _session_factory
    _session_factory = session_factory
    AppBase.metadata.create_all(bind=engine)


def get_setting(key: str) -> str | None:
    s = _session_factory()
    try:
        row = s.get(AppSetting, key)
        return row.value if row else None
    finally:
        s.close()


def set_setting(key: str, value: str | None) -> None:
    s = _session_factory()
    try:
        row = s.get(AppSetting, key)
        if row is None:
            s.add(AppSetting(key=key, value=value))
        else:
            row.value = value
        s.commit()
    finally:
        s.close()


def get_reviewer() -> str | None:
    return get_setting("reviewer")


def set_reviewer(name: str | None) -> None:
    set_setting("reviewer", name)


# ── Renderer prefs (the kit /v1/prefs hooks) — `pref.<key>` rows, JSON values ──

_PREF_PREFIX = "pref."


def prefs_read_all() -> dict:
    import json

    s = _session_factory()
    try:
        out: dict = {}
        for row in s.query(AppSetting).filter(AppSetting.key.like(f"{_PREF_PREFIX}%")).all():
            try:
                out[row.key[len(_PREF_PREFIX):]] = json.loads(row.value)
            except (ValueError, TypeError):
                out[row.key[len(_PREF_PREFIX):]] = None
        return out
    finally:
        s.close()


def prefs_write_many(patch: dict) -> None:
    import json

    s = _session_factory()
    try:
        for key, value in patch.items():
            row_key = _PREF_PREFIX + key
            encoded = json.dumps(value)
            row = s.get(AppSetting, row_key)
            if row is None:
                s.add(AppSetting(key=row_key, value=encoded))
            else:
                row.value = encoded
        s.commit()
    finally:
        s.close()


def prefs_clear() -> None:
    s = _session_factory()
    try:
        s.query(AppSetting).filter(AppSetting.key.like(f"{_PREF_PREFIX}%")).delete(
            synchronize_session=False
        )
        s.commit()
    finally:
        s.close()
