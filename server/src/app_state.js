// SPDX-License-Identifier: MIT
// Application-wide state container (the family setState/getState shape). The port of
// app_state.py.
//
// Holds the long-lived singletons: the data dir and the review Workspace. API modules and
// tests reach them through `getState()`, the same seam JW and JV use.

import { RuntimeError } from "@delebash/llm-runner/platform/py";

export class AppState {
  constructor(dataDir, workspace) {
    this.dataDir = dataDir;
    this.workspace = workspace;
  }
}

// Singleton — set in createApp during boot.
let STATE = null;

export function setState(state) {
  STATE = state;
}

export function getState() {
  if (STATE === null) throw new RuntimeError("AppState not initialized — call setState() during boot");
  return STATE;
}
