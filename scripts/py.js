#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Python launcher for the npm scripts. Resolves THIS PROJECT'S interpreter
// (server/.venv preferred, PATH fallback; JAID_PYTHON overrides) and execs it
// with the args — the kit's shared resolver, bound to this repo's layout
// (target-tree P7).
//
//   node scripts/py.js -m pytest -q
//   node scripts/py.js -m just_ai_i18n_docgen.serve serve
//
// WHY: bare `python` resolves to whatever is first on PATH — on a stock box an
// interpreter with none of this project's dependencies, and the failure reads
// as broken test config instead of a missing install.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runPython } from "../../just-llm-runner/scripts/lib/exec-resolve.mjs";

runPython(process.argv.slice(2), {
  env: "JAID_PYTHON",
  root: join(dirname(fileURLToPath(import.meta.url)), ".."),
  venvs: ["server/.venv"],
});
