# SPDX-License-Identifier: MIT
"""Application-wide state container (the family set_state/get_state shape).

Holds the long-lived singletons: the data dir and the review Workspace —
previously loose on `app.state`. API modules and tests reach them through
`get_state()`, the same seam JW and JV use.
"""

from __future__ import annotations

from pathlib import Path

from .workspace import Workspace


class AppState:
    def __init__(self, data_dir: Path, workspace: Workspace):
        self.data_dir = data_dir
        self.workspace = workspace


# Singleton — set in create_app during boot.
_STATE: AppState | None = None


def set_state(state: AppState) -> None:
    global _STATE
    _STATE = state


def get_state() -> AppState:
    if _STATE is None:
        raise RuntimeError("AppState not initialized — call set_state() during boot")
    return _STATE
