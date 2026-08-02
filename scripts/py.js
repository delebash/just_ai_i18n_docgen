#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Python launcher for the npm scripts — JW's pattern (scripts/py.js), self-contained.
// Resolves THIS PROJECT'S interpreter (server/.venv) and execs it with the args.
//
//   node scripts/py.js -m pytest -q
//   node scripts/py.js -m just_ai_i18n_docgen.serve serve
//
// WHY: bare `python` resolves to whatever is first on PATH — on a stock box that is
// an interpreter with none of this project's dependencies, and the failure reads as
// broken test config instead of a missing install. Venv preferred; PATH fallback.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const override = process.env.JAID_PYTHON;
const candidates = [
  override,
  join(root, "server", ".venv", "Scripts", "python.exe"),
  join(root, "server", ".venv", "bin", "python"),
].filter(Boolean);
const python = candidates.find((p) => existsSync(p))
  ?? (process.platform === "win32" ? "python" : "python3");

const args = process.argv.slice(2);
if (!args.length) {
  console.error("scripts/py.js: no arguments — expected e.g. `-m pytest -q`");
  process.exit(2);
}
const child = spawn(python, args, { stdio: "inherit", shell: false });
child.on("exit", (code) => process.exit(code ?? 1));
