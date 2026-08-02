# SPDX-License-Identifier: MIT
"""App-owned settings — the host's OWN domain table, on its OWN Base.

The family pattern (llm-runner's db.py documents it): the shared stack owns the LLM
tables; the host "has its own domain tables on its own Base" and shares the engine.
This app has exactly one machine-level fact of its own so far: the REVIEWER's name —
asked for once, stamped on every acceptance, so a verdict can say who made it. Never
the OS username: an automated run under a developer's account would inherit it and
become indistinguishable from that developer's judgement, which is the exact failure
the field exists to expose.
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
