// SPDX-License-Identifier: MIT
// The server entry — `serve.js serve [--host H] [--port P] [--data-dir D] [--config C]`, run
// headless or by the desktop shell (its `utilityProcess`, which reads the `ready` message the
// kit's runServer posts). The port of serve.py.
//
//   node scripts/node24.js server/src/serve.js serve --port 8742
//
// Defaults as Python's: host 127.0.0.1, port 8742; the data dir is `--data-dir`, else
// JUST_AI_I18N_DOCGEN_DATA_DIR, else the family ladder (`<repo>/data` in a checkout).
// `--config` pre-loads a project (else the setup screen creates one). runServer also reads
// JUST_AI_I18N_DOCGEN_HOST / _PORT / _LOG_LEVEL.
//
// Data seeding lives HERE, not in createApp(): the test suite's createApp(tmp) apps start
// unseeded (the family call-site).

import path from "node:path";
import { pathToFileURL } from "node:url";
import { runServer } from "@delebash/core/platform";
import { setLevel } from "@delebash/core/platform/log";
import { createApp, defaultDataDir, seedLlmStack } from "./app.js";
import { DEFAULT_PORT, PRODUCT } from "./version.js";

/** Takes `--config X` / `--config=X` out of argv (runServer's parser knows only its own). */
export function splitConfigArg(argv) {
  const rest = [];
  let config = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") {
      if (i + 1 >= argv.length) throw new Error("argument --config: expected one argument");
      config = argv[++i];
    } else if (a.startsWith("--config=")) config = a.slice("--config=".length);
    else rest.push(a);
  }
  return { config, rest };
}

export async function main(argv = process.argv.slice(2)) {
  const { config, rest } = splitConfigArg(argv);
  await runServer({
    argv: rest,
    envPrefix: "JUST_AI_I18N_DOCGEN",
    // One server per data folder (the kit's platform/data_lock.js, 2026-10-15): the folder — the
    // family ladder when none is named — is locked before `build` opens it.
    productName: PRODUCT,
    defaultDataDir,
    build: async ({ dataDir, host, port, logLevel }) => {
      setLevel(logLevel);
      const app = await createApp(dataDir, config);
      seedLlmStack();
      const h = host || "127.0.0.1";
      const p = port ?? DEFAULT_PORT;
      return { app, host: h, port: p, banner: `${PRODUCT} server listening on http://${h}:${p}` };
    },
  });
}

// Run when started as a program — by the desktop app (a utilityProcess has `parentPort`) or as
// `node …/serve.js` — not when a test imports it (the template's entry check, template/server/src/serve.js).
const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (process.parentPort || entry === import.meta.url) await main();
