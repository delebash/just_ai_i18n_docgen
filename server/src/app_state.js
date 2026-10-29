// SPDX-License-Identifier: MIT
// Application-wide state container (the family setState/getState shape). The port of
// app_state.py.
//
// Holds the long-lived singletons: the data dir, the review Workspace and the app's jobs (the
// kit's JobRegistry — a translation run, jobs.js; one for the server's life, so a project
// loaded while a run goes on can't start a second one). API modules and tests reach them
// through `getState()`, the same seam JW and JV use.

import { JobRegistry } from "@delebash/core/platform";
import { RuntimeError } from "@delebash/core/platform/py";

export class AppState {
  constructor(dataDir, workspace, jobs = new JobRegistry()) {
    this.dataDir = dataDir;
    this.workspace = workspace;
    this.jobs = jobs;
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
