// SPDX-License-Identifier: MIT
// The Fastify application factory — the standard, three lines of wiring. The port of app.py.
//
// The rewrite of just-ai-help, embedding the shared LLM stack the way every family app does
// (JW, JV): mount the kit's runner router, call `installLlm` (data SEEDING lives in
// `seedLlmStack()`, called by serve.js and the CLI door). The engine half of the old Node
// tool — settings, engines.json, all hardware/model selection — does not exist here, because
// the kit owns all of it.
//
// The FEATURES are this tool's actions, registered with the shared routing surface so each
// one points at an engine preset that owns provider+model+temperature/think:
//
//     translate — the batch loop (the old `translate.js`)
//     review    — back-translation + the confirmation pass (`confirm.js`)
//     confirm   — the second-opinion pass on byte-identical targets
//
// `featurePrompts: {}` is DELIBERATE and load-bearing: this tool builds its own prompts
// (shielding is a substitution — see shieldlib.js) and dispatches directly. The shared prompt
// store never carries them.
//
// What stays JSON, per the 2026-08-01 ruling: `config.json`, `<lang>.accepted.json`,
// `<lang>.notes.json` — they belong to the app being translated and live in ITS repo. Machine
// state (providers, keys, presets, tunes, usage) lives in the shared DB here.
//
// docgen answers FastAPI's DEFAULT errors (it never called install_error_handlers — the kit's
// route diff, 2026-10-08), plus its own catch-all envelope for an unhandled exception.

import { mkdirSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { installLlm, router as runnerRouter } from "@delebash/llm-runner";
import { LLM_TABLES, loadFromConfigs, seedLlm, stores } from "@delebash/llm-runner/llm";
import * as llmDb from "@delebash/llm-runner/llm/db";
import { FeatureCatalogEntry } from "@delebash/llm-runner/llm/routing_api";
import {
  BearerAuthMiddleware,
  createServer,
  CsrfOriginMiddleware,
  installFileLog,
  installLogRing,
  makeDataRouter,
  makeDiskRouter,
  makeLogsRouter,
  makePrefsRouter,
  openDatabase,
  resolveDataDir,
} from "@delebash/llm-runner/platform";
import { sortedTables } from "@delebash/llm-runner/platform/data_api";
import { purePath } from "@delebash/llm-runner/platform/data_paths";
import { HttpError, RequestValidationError } from "@delebash/llm-runner/platform/errors";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as lifecycle from "@delebash/llm-runner/runner/lifecycle";
import { router as healthRouter } from "./api/health_api.js";
import { router as serverAuthRouter } from "./api/server_auth_api.js";
import { router as setupRouter } from "./api/setup_api.js";
import { router as workspaceRouter } from "./api/workspace_api.js";
import { AppState, setState } from "./app_state.js";
import * as appmeta from "./appmeta.js";
import { APP_TABLES } from "./appmeta.js";
import { readAuth } from "./auth.js";
import { cpSlice, errText } from "./jsonio.js";
import { isDir } from "./paths.js";
import { PRODUCT } from "./version.js";
import { Workspace } from "./workspace.js";

const log = getLogger("just_ai_i18n_docgen.app");

const TYPE_BASE = "https://just-ai-i18n-docgen.dev/errors/";

export const FEATURE_CATALOG = [
  FeatureCatalogEntry({
    key: "translate",
    label: "Translate",
    hint: "The batch translate loop — shield, send, restore, check.",
    group: "i18n",
  }),
  FeatureCatalogEntry({
    key: "review",
    label: "Review",
    hint: "Back-translation shown to the reviewer; never written to a catalogue.",
    group: "i18n",
  }),
  FeatureCatalogEntry({
    key: "confirm",
    label: "Confirm",
    hint: "The second opinion on byte-identical targets — annotates, never signs off.",
    group: "i18n",
  }),
  // Extract is NOT here on purpose (2026-08-04 ruling): it is pure front-matter parsing — no
  // engine call anywhere in extract.js — and a routing row for a feature that cannot route
  // is a lie. The CLI door (`… extract <config>`) is untouched. Re-register it the day it
  // gains a real AI step.
];

// The engine presets — one-source: the preset owns provider+model+every tunable, and each
// feature points at one (JW's model, seed shape included). Temperature 0.2 is the Node loop's
// MEASURED constant carried over: low enough for consistency, high enough that the probe's
// two passes can disagree — the probe guard reads this value from the resolved preset
// (engine.js) and refuses at 0. `model: ""` = the provider's default model; insert-if-missing,
// so a user's Lab edits are never clobbered by a reseed. (Seed rows keep Python's snake_case
// keys — the kit's seeders read them.)
export const DEFAULT_ENGINE_PRESETS = [
  { id: "p_translate", name: "Translate", provider_id: "local-llamacpp", model: "", temperature: 0.2, position: 0, think: false },
  // The confirmation pass asks about byte-identical keys; same profile, its own preset so
  // escalating or re-pointing one never silently moves the other.
  { id: "p_confirm", name: "Confirm", provider_id: "local-llamacpp", model: "", temperature: 0.2, position: 1, think: false },
];

export const DEFAULT_FEATURE_PRESETS = {
  translate: "p_translate",
  review: "p_translate", // back-translation: same engine the translation used
  confirm: "p_confirm",
  extract: "p_translate",
};

export const DEFAULT_PRESET_ID = "p_translate";

// The app's OWN model catalog — TRANSLATION-measured rows only, ranked by the measured table
// (just-ai-help/docs/models.md; the 40-key stress corpus + the 1,965-key live run). Since
// decision ④ (family parity batch 2026-08-05) EVERY app seeds its whole catalog — the kit's
// shared DEFAULT_CATALOG is empty. No embedding rows: this app has no embedding features.
// license/ctx values follow the family's audited pattern for the same repos — re-run the
// seed-facts audit (network) whenever these rows change.
export const MODEL_CATALOG = [
  {
    id: "gemma-4-26b-a4b-qat-xl",
    name: "Gemma 4 26B-A4B (QAT)",
    hf_repo: "unsloth/gemma-4-26B-A4B-it-qat-GGUF",
    quant: "UD-Q4_K_XL",
    total_params: "26B",
    active_params: "4B",
    type: "moe",
    mtp: true,
    mtp_draft_repo: "unsloth/gemma-4-26B-A4B-it-qat-GGUF",
    mtp_draft_file: "MTP/mtp-gemma-4-26B-A4B-it-Q4_0.gguf",
    mtp_draft_quant: "Q4_0",
    trained_ctx: 262144,
    samplers: { top_k: "64", top_p: "0.95", temperature: "1" },
    min_vram_mb: 4096,
    min_ram_mb: 24576,
    tier: "low-vram-moe",
    license: "Apache-2.0",
    position: 0,
    quality_rank: 1,
    architecture: "gemma4",
    experts: 128,
    description:
      "26B MoE (4B active) · 256k context · the MEASURED flagship: most " +
      "accurate AND fastest on the stress corpus and the 1,965-key live run",
    notes: "The default pick when it fits (needs ~24 GB RAM for expert offload).",
  },
  // The ONE recorded exception to the measured-only rule (user ruling 2026-08-06: "replace
  // gemma 3 with gemma 4 even though it is untested"): Gemma 4 12B (QAT) takes the 12B slot
  // on strong expectation, but it has NOT run the translation corpus yet. The description says
  // so honestly; the measurement task is in TASKS, and Gemma 3 12B's measured row ("0
  // structural, 1 semantic flag") returns from git if the numbers disappoint. Row facts from
  // JW's audited seed.
  {
    id: "gemma-4-12b-qat",
    name: "Gemma 4 12B (QAT)",
    hf_repo: "unsloth/gemma-4-12B-it-qat-GGUF",
    quant: "UD-Q4_K_XL",
    total_params: "12B",
    type: "dense",
    mtp: true,
    est_vram_mb: 10721,
    mtp_draft_file: "MTP/mtp-gemma-4-12B-it-Q4_0.gguf",
    mtp_draft_quant: "Q4_0",
    size_label: "12B",
    size_bytes: 6716355328,
    trained_ctx: 262144,
    samplers: { top_k: "64", top_p: "0.95", temperature: "1" },
    min_vram_mb: 8192,
    min_ram_mb: 12288,
    tier: "mid",
    license: "Apache-2.0",
    position: 1,
    quality_rank: 2,
    architecture: "gemma4",
    experts: 0,
    description:
      "12B dense (QAT) · 256k context · NOT yet measured on the " +
      "translation corpus — expected to beat Gemma 3 12B (newer " +
      "family, quantization-aware quant); measure to confirm",
    notes: "The 8-12 GB-card pick, pending its measurement run.",
  },
  {
    id: "hy-mt2-7b",
    name: "Hunyuan-MT2 7B (translation-tuned)",
    hf_repo: "tencent/Hy-MT2-7B-GGUF",
    quant: "Q4_K_M",
    total_params: "7B",
    type: "dense",
    trained_ctx: 32768,
    min_vram_mb: 6144,
    min_ram_mb: 8192,
    tier: "small",
    license: "tencent-hunyuan-community",
    position: 2,
    quality_rank: 3,
    architecture: "hunyuan",
    experts: 0,
    description: "7B translation-tuned · MEASURED: 0 structural, 3 semantic flags",
    notes: "Small and fast. Caveat, measured: the family can drop Spanish opening ¿ — keep the checks on.",
  },
];

// The flagship's MEASURED class tunes (decision ④, 2026-08-05: class tunes are per-app data
// and travel with the model). Registered under the id the family MEASURED them on; the
// identity map below binds them onto this app's own `-xl` row (same GGUF, different id —
// without it this app launched the 26B on automatic fit, ctx 16384 with no expert offload,
// against a measured ctx 32768 + n_cpu_moe 21). Six rows, verbatim from the shared seed at
// the move; the full 13-row measured library lives in JW's seed_presets.py.
export const CLASS_TUNES = [
  {
    model_id: "gemma-4-26b-a4b-qat",
    class_key: "dgpu-vram8|ram32",
    switches: {
      n_gpu_layers: "99",
      n_cpu_moe: "21",
      ctx_len: "32768",
      batch_size: "512",
      ubatch_size: "512",
      threads: "8",
      reasoning_budget: "1024",
    },
  },
  {
    model_id: "gemma-4-26b-a4b-qat",
    class_key: "igpu-mem32",
    switches: {
      n_gpu_layers: "99",
      n_cpu_moe: "0",
      ctx_len: "32768",
      batch_size: "512",
      ubatch_size: "512",
      flash_attn: "off",
      reasoning_budget: "1024",
    },
  },
  {
    model_id: "gemma-4-26b-a4b-qat",
    class_key: "dgpu-vram16|ram32",
    switches: { ctx_len: "32768", batch_size: "512", ubatch_size: "512", reasoning_budget: "1024" },
  },
  {
    model_id: "gemma-4-26b-a4b-qat",
    class_key: "dgpu-vram16|ram64",
    switches: { ctx_len: "32768", batch_size: "512", ubatch_size: "512", reasoning_budget: "1024" },
  },
  {
    model_id: "gemma-4-26b-a4b-qat",
    class_key: "dgpu-vram24|ram32",
    switches: {
      n_gpu_layers: "99",
      n_cpu_moe: "0",
      ctx_len: "32768",
      batch_size: "512",
      ubatch_size: "512",
      reasoning_budget: "1024",
    },
  },
  {
    model_id: "gemma-4-26b-a4b-qat",
    class_key: "dgpu-vram24|ram64",
    switches: {
      n_gpu_layers: "99",
      n_cpu_moe: "0",
      ctx_len: "32768",
      batch_size: "512",
      ubatch_size: "512",
      reasoning_budget: "1024",
    },
  },
];

export const CLASS_TUNE_IDENTITY = {
  "gemma-4-26b-a4b-qat": { hf_repo: "unsloth/gemma-4-26B-A4B-it-qat-GGUF", quant: "UD-Q4_K_XL" },
};

// The checkout root in a source install: server/src/app.js → repo. (A packaged build ignores
// it — the kit uses the executable's own folder.)
export const SOURCE_ROOT = path.resolve(import.meta.dirname, "..", "..");

// The desktop window's origin (the shared Electron shell loads the UI from app://<id>):
// without it every mutating call from the desktop app gets the CSRF 403.
export const APP_ORIGINS = ["http://localhost:1450", "http://127.0.0.1:1450", "app://just-ai-i18n-docgen"];

/**
 * The app's data root, per the ONE family policy (user ruling 2026-08-14 — "absolutely no
 * data ... stored anywhere but where the user has set the storage directory, which by default
 * will be the install directory for the app"). Thin call into the kit; the ladder may never
 * be re-implemented here. The desktop shell resolves the identical ladder and hands the
 * result down via the env var; this governs HEADLESS runs.
 */
export function defaultDataDir() {
  return resolveDataDir({
    appName: "just-ai-i18n-docgen",
    envVar: "JUST_AI_I18N_DOCGEN_DATA_DIR",
    sourceRoot: SOURCE_ROOT,
  });
}

/**
 * Once, marker-guarded: the 2026-08-06 user ruling replaced Gemma 3 12B with Gemma 4 12B
 * (QAT) in the catalog seed. Fresh installs never see the old row; an existing DB drops
 * exactly the seeded `gemma-3-12b-it` id (a user-added row has a different id; a downloaded
 * GGUF stays on disk). The new row arrives via the seed's own insert-if-missing. Best-effort
 * — never boot-fatal.
 */
export function _retireGemma3Row() {
  try {
    const h = llmDb.session();
    if (h.get("runner_setting", "jaid_gemma3_12b_retired") !== null) return;
    h.tx(() => {
      if (h.get("model_catalog", "gemma-3-12b-it") !== null) {
        h.delete("model_catalog", { id: "gemma-3-12b-it" });
        for (const child of ["model_samplers", "model_embed_templates"]) h.delete(child, { model_id: "gemma-3-12b-it" });
      }
      h.insert("runner_setting", { key: "jaid_gemma3_12b_retired", value: "1" });
    });
  } catch (e) {
    // a seed nicety, never boot-fatal
    log.warning(`gemma-3 catalog retirement failed (the row remains visible): ${errText(e)}`);
  }
}

async function stopRunnerBestEffort() {
  try {
    await lifecycle.getService().stop();
  } catch {
    /* best-effort by design, never boot-fatal */
  }
}

/** `metadata.drop_all` — every table of a captured list, children first. */
function dropTables(h, tables) {
  for (const t of [...sortedTables(tables)].reverse()) h.exec(`DROP TABLE IF EXISTS "${t}"`);
}

/** installLlm's arguments — the same for the app and the routeless (CLI) boot. */
const llmArgs = (h, dataDir) => ({
  db: h,
  featureCatalog: FEATURE_CATALOG,
  featurePrompts: {}, // prompts are OURS — see the header
  enginePresets: DEFAULT_ENGINE_PRESETS,
  featurePresets: DEFAULT_FEATURE_PRESETS,
  defaultPresetId: DEFAULT_PRESET_ID,
  modelCatalogExtra: MODEL_CATALOG,
  classTunesSeed: CLASS_TUNES,
  classTuneIdentity: CLASS_TUNE_IDENTITY,
  dataDir,
  // Names this app in the family cache registry, so the NEXT app installed can offer to share
  // these engine + model files instead of re-downloading.
  product: PRODUCT,
});

/**
 * The stack WITHOUT the app's own routes — storage wiring + the app's own table. (Data
 * seeding lives in seedLlmStack(), serve-time.)
 *
 * Split from createApp because the CLI needs it too: `makeSend` resolves presets through the
 * shared stores, which do not exist until storage is configured. When `app` is given, the
 * kit's routers are mounted as well (createApp's path). Returns the data dir.
 */
export async function bootLlmStack(dataDir = null, app = null) {
  dataDir = dataDir ? purePath(String(dataDir)) : defaultDataDir();
  mkdirSync(dataDir, { recursive: true });

  // docgen never turned foreign keys on (Python's sqlite3 default) — kept OFF, decided:
  // identical behaviour (plan §5).
  const h = openDatabase(path.join(dataDir, "app.db"), { foreignKeys: false });

  if (app !== null) {
    // The standard: the host mounts the runner's process API, installLlm mounts the rest —
    // JW's exact order.
    app.register(runnerRouter);
    // The shared /v1/data backup/restore/reset. One DB, two table sets; no asset dirs —
    // per-project text lives in the USER'S project, anchored to the config file, never under
    // the data dir. Reset = drop both schemas + recreate + reseed (the family true-drop rule:
    // schema drift resets too); restore/reset tear the runner down first (clean slate).
    const reset = async () => {
      await stopRunnerBestEffort();
      dropTables(h, APP_TABLES);
      dropTables(h, LLM_TABLES);
      h.createTables(APP_TABLES);
      h.createTables(LLM_TABLES);
      seedLlm();
    };
    app.register(
      makeDataRouter({
        getDbPath: () => path.join(dataDir, "app.db"),
        metadata: [APP_TABLES, LLM_TABLES],
        runReset: reset,
        assetDirs: () => ({}),
        onReplaced: stopRunnerBestEffort,
      }),
    );
    // The family /v1/prefs door: the renderer's prefs are `pref.*` rows in app_settings —
    // same DB, so the backup/restore/reset above covers them.
    app.register(
      makePrefsRouter({
        readAll: appmeta.prefsReadAll,
        writeMany: appmeta.prefsWriteMany,
        clear: appmeta.prefsClear,
      }),
    );
    await installLlm(app, llmArgs(h, dataDir));
  } else {
    // Routeless boot — the CLI door. installLlm(null) is first-class in the shared package:
    // same storage/seed/wiring path, no routes.
    await installLlm(null, llmArgs(h, dataDir));
  }

  // The app's OWN table (reviewer identity + `pref.*` renderer prefs) — one database, two
  // table sets, the documented family pattern.
  appmeta.configureAppStorage(h);
  return dataDir;
}

/**
 * Serve-time data seeding — the half bootLlmStack doesn't do. The shared seed
 * (insert-if-missing), the one-time gemma-3 catalog-row retirement, and the provider-registry
 * boot FROM the DB. Called by serve.js and the CLI door after bootLlmStack; the test suite's
 * createApp(tmp) apps stay unseeded unless a test seeds them.
 */
export function seedLlmStack() {
  seedLlm();
  _retireGemma3Row();
  loadFromConfigs(stores.getProviderStore().list());
}

// ── CORS: Starlette's CORSMiddleware(allow_origins=["*"], allow_methods=["*"],
// allow_headers=["*"]) — answers preflights itself, stamps `*` on every other answer to a
// request that carries an Origin (the request's own origin + Vary when it carries a cookie).
// Candidate for platform/.
const ALL_METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"];

export async function corsAllowAll(request, reply) {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  const wanted = request.headers["access-control-request-method"];
  if (request.method === "OPTIONS" && wanted !== undefined) {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": ALL_METHODS.join(", "),
      "access-control-max-age": "600",
    };
    const asked = request.headers["access-control-request-headers"];
    if (asked !== undefined) headers["access-control-allow-headers"] = asked; // allow-all mirrors
    const ok = ALL_METHODS.includes(wanted);
    reply
      .code(ok ? 200 : 400)
      .headers(headers)
      .type("text/plain; charset=utf-8")
      .send(ok ? "OK" : "Disallowed CORS method");
    return reply;
  }
  if (request.headers.cookie !== undefined) {
    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
  } else reply.header("access-control-allow-origin", "*");
}

/** The hook as a root-level plugin, so it loads in its place among the other two. */
export async function CorsAllowAllMiddleware(app) {
  app.addHook("onRequest", corsAllowAll);
}
CorsAllowAllMiddleware[Symbol.for("skip-override")] = true;

/** True for an error FastAPI's own handlers don't answer — the envelope's to catch. */
function isUnhandled(err) {
  if (err instanceof HttpError || err instanceof RequestValidationError || err?.validation) return false;
  if (err?.code === "FST_ERR_CTP_INVALID_JSON_BODY" || err?.code === "FST_ERR_CTP_EMPTY_JSON_BODY") return false;
  return !(err?.statusCode && err.statusCode < 500);
}

/** The Fastify app: the kit, the data/prefs/logs/disk routers, the workspace and the UI. */
export async function createApp(dataDir = null, configPath = null) {
  dataDir = dataDir ? purePath(String(dataDir)) : defaultDataDir();

  // Server logs → in-memory ring (the Settings → Logs viewer) + a per-day file that survives
  // a crash/boot-hang. Shared platform helpers, same in every app.
  installLogRing();
  installFileLog(path.join(dataDir, "logs", "just-ai-i18n-docgen.log"));

  const app = createServer({ errors: "fastapi" });
  const fastapiHandler = app.errorHandler;

  // Python's middleware order: CSRF outermost, then CORS, then auth. Fastify runs onRequest
  // hooks in the order the three plugins load (registration order), so the same order here —
  // all three registered as root plugins, never one by a bare addHook (that would run
  // first): a CSRF 403 carries no CORS headers; CORS answers preflights before auth sees them
  // and stamps auth's 401/403.
  //
  // CSRF: reject cross-site browser mutations to /v1 (no token — can never lock anyone out).
  // With allow-all CORS, this is what stops a foreign web page from WRITING to :8742 while the
  // app runs.
  app.register(CsrfOriginMiddleware, { appOrigins: APP_ORIGINS, typeBase: TYPE_BASE });
  // CORS — allow-all: the kit's origin-aware resolver hits :8742 DIRECTLY from Vite dev
  // (:1450) and from the desktop window, so without this every request dies as a silent CORS
  // block (found live 2026-08-02 — no same-origin test can see it).
  app.register(CorsAllowAllMiddleware);
  // Bearer auth — OFF unless tokens are configured (Settings → Server). Gates /v1/* only.
  app.register(BearerAuthMiddleware, { readAuth, typeBase: TYPE_BASE });

  // Every route lives in one encapsulated scope that owns the catch-all error envelope (a
  // second setErrorHandler on the root would only override it — Fastify warns): an unhandled
  // exception becomes a JSON 500 that still carries the CORS headers (stamped on the
  // request), so the browser sees a real error instead of a CORS block. JW parity — verified
  // the hard way in JV, 2026-06-12. Awaited, so the stack is booted when createApp returns.
  await app.register(async function docgen(scope) {
    scope.setErrorHandler(function errorEnvelope(err, request, reply) {
      if (!isUnhandled(err)) return fastapiHandler.call(this, err, request, reply);
      log.exception(`unhandled error on ${request.method} ${request.url.split("?")[0]}`, err);
      return reply.code(500).send({ title: "Internal Server Error", detail: cpSlice(errText(err), 0, 300) });
    });

    await bootLlmStack(dataDir, scope);

    // Shared platform surfaces: the log ring's API and the read-only disk-usage route the
    // Settings → Storage panel reads.
    scope.register(makeLogsRouter(PRODUCT));
    scope.register(makeDiskRouter(dataDir));

    // The review workspace: starts with NO project (the setup screen creates one);
    // `configPath` pre-loads one for a configured launch. The handle lives in app_state (the
    // family setState/getState seam).
    const workspace = new Workspace(configPath);
    setState(new AppState(dataDir, workspace));
    scope.register(healthRouter);
    scope.register(serverAuthRouter);
    scope.register(setupRouter);
    scope.register(workspaceRouter);

    // Headless UI — serve the Vite build so the server + a browser gives the full app
    // without the desktop shell (the kit's origin-aware serverApi targets
    // window.location.origin). Every /v1/* route wins first (a static route beats the
    // wildcard). Starlette's StaticFiles(html=True) semantics: "/" is index.html; a missing
    // file answers FastAPI's {"detail": "Not Found"}; any method but GET/HEAD on an unrouted
    // path answers 405.
    const dist = path.join(SOURCE_ROOT, "dist");
    if (isDir(dist)) {
      scope.register(fastifyStatic, {
        root: dist,
        prefix: "/",
        wildcard: true,
        index: ["index.html"],
        redirect: false,
        cacheControl: false,
      });
      scope.route({
        method: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        url: "/*",
        handler: async () => {
          throw new HttpError(405, "Method Not Allowed");
        },
      });
    }
  });

  return app;
}
