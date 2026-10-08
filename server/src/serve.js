// SPDX-License-Identifier: MIT
// The server entry — `serve.js serve [--host H] [--port P] [--data-dir D] [--config C]`, run
// headless or by the desktop shell (its `utilityProcess`, which reads the `ready` message the
// kit's runServer posts). The port of serve.py.
//
//   node scripts/node24.mjs server/src/serve.js serve --port 8742
//
// Defaults as Python's: host 127.0.0.1, port 8742; the data dir is `--data-dir`, else
// JUST_AI_I18N_DOCGEN_DATA_DIR, else the family ladder (`<repo>/data` in a checkout).
// `--config` pre-loads a project (else the setup screen creates one). runServer also reads
// JUST_AI_I18N_DOCGEN_HOST / _PORT / _LOG_LEVEL.
//
// Data seeding lives HERE, not in createApp(): the test suite's createApp(tmp) apps start
// unseeded (the family call-site).

import { runServer } from "@delebash/llm-runner/platform";
import { setLevel } from "@delebash/llm-runner/platform/log";
import { createApp, seedLlmStack } from "./app.js";
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

const { config, rest } = splitConfigArg(process.argv.slice(2));

await runServer({
  argv: rest,
  envPrefix: "JUST_AI_I18N_DOCGEN",
  build: async ({ dataDir, host, port, logLevel }) => {
    setLevel(logLevel);
    const app = await createApp(dataDir, config);
    seedLlmStack();
    const h = host || "127.0.0.1";
    const p = port ?? DEFAULT_PORT;
    return { app, host: h, port: p, banner: `${PRODUCT} server listening on http://${h}:${p}` };
  },
});
