// SPDX-License-Identifier: MIT
// The Hono application factory — the standard, three lines of wiring. The port of app.py.
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
//     review    — Review's back-translation
//     confirm   — the second-opinion pass on byte-identical targets (`confirm.js`)
//
// Each has one PROMPT ROW of the same key (seed_feature_prompts.js), editable in the AI Lab and
// run by the kit's runAction (engine.js). Until 2026-10-29 `featurePrompts` was `{}`: docgen built
// its prompts in code and the Lab showed a read-only preview. Shielding is still a substitution
// done before a row renders (shieldlib.js): the model sees ⟦n⟧ tokens, never a placeholder.
//
// What stays JSON, per the 2026-08-01 ruling: `config.json`, `<lang>.accepted.json`,
// `<lang>.notes.json` — they belong to the app being translated and live in ITS repo. Machine
// state (providers, keys, presets, tunes, usage) lives in the shared DB here.
//
// docgen answers FastAPI's DEFAULT errors (it never called install_error_handlers — the kit's
// route diff, 2026-10-08), plus its own catch-all envelope for an unhandled exception.

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { installLlm, runnerRouter } from "@delebash/core/llm";
import { loadFromConfigs, seedLlm, stores } from "@delebash/core/llm";
import * as llmDb from "@delebash/core/llm/db";
import { FeatureCatalogEntry } from "@delebash/core/llm/routing_api";
import {
  bearerAuth,
  CAPACITOR_ORIGINS,
  ChangeCounter,
  createServer,
  csrfOrigin,
  installFileLog,
  installLogRing,
  JobRegistry,
  MaintenanceGate,
  makeDiskRouter,
  makeJobsRouter,
  makeLogsRouter,
  makePrefsRouter,
  makeShutdownRouter,
  makeSyncRevRouter,
  openDatabase,
  resolveDataDir,
  resourceIsolation,
  SHUTDOWN_PATH,
  serveUi,
  starletteCors,
} from "@delebash/core/platform";
import { purePath } from "@delebash/core/platform/data_paths";
import { getLogger } from "@delebash/core/platform/log";
import { errText } from "@delebash/core/platform/py";
import { router as healthRouter } from "./api/health_api.js";
import { router as serverAuthRouter } from "./api/server_auth_api.js";
import { router as setupRouter } from "./api/setup_api.js";
import { router as settingsRouter } from "./api/settings_api.js";
import { router as workspaceRouter } from "./api/workspace_api.js";
import { AppState, getState, setState } from "./app_state.js";
import * as appmeta from "./appmeta.js";
import { readAuth } from "./auth.js";
import { router as dataRouter } from "./data_admin.js";
import { isDir } from "./paths.js";
import { DEFAULT_FEATURE_PROMPTS } from "./seed_feature_prompts.js";
import { DEFAULT_TEST_SAMPLES } from "./seed_test_samples.js";
import { PRODUCT } from "./version.js";
import { getAppSetting, seedSettings, setAppSetting, upgradeSettings } from "./settings.js";
import { Workspace } from "./workspace.js";

const log = getLogger("just_ai_i18n_docgen.app");

const TYPE_BASE = "https://just-ai-i18n-docgen.dev/errors/";

export const FEATURE_CATALOG = [
  FeatureCatalogEntry({
    key: "translate",
    label: "Translate",
    hint: "The batch translate loop — shield, send, restore, check.",
    group: "i18n",
    // The catalog keys for the words (the seeded-words plan, 2026-10-18): the kit's AI page
    // shows them in the interface's language; the English above is its fallback.
    labelKey: "common.translate",
    hintKey: "aiData.feature.translate.hint",
    groupKey: "aiData.group.i18n",
  }),
  FeatureCatalogEntry({
    key: "review",
    label: "Review",
    hint: "Back-translation shown to the reviewer; never written to a catalogue.",
    group: "i18n",
    labelKey: "aiData.feature.review.label",
    hintKey: "aiData.feature.review.hint",
    groupKey: "aiData.group.i18n",
  }),
  FeatureCatalogEntry({
    key: "confirm",
    label: "Confirm",
    hint: "The second opinion on byte-identical targets — annotates, never signs off.",
    group: "i18n",
    labelKey: "aiData.feature.confirm.label",
    hintKey: "aiData.feature.confirm.hint",
    groupKey: "aiData.group.i18n",
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
  // nameKey: the name in the interface's language while the stored name is still this seed's.
  { id: "p_translate", name: "Translate", nameKey: "common.translate", provider_id: "local-llamacpp", model: "", temperature: 0.2, position: 0, think: false },
  // The confirmation pass asks about byte-identical keys; same profile, its own preset so
  // escalating or re-pointing one never silently moves the other.
  { id: "p_confirm", name: "Confirm", nameKey: "aiData.preset.confirm", provider_id: "local-llamacpp", model: "", temperature: 0.2, position: 1, think: false },
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
  // Gemma 4 12B (QAT) took the 12B slot untested (user ruling 2026-08-06: "replace gemma 3 with
  // gemma 4 even though it is untested") and was measured 2026-10-29 on the rebuilt 40-key corpus
  // beside the 26B, one run each on an 8 GB card (docs/dev/RESEARCH.md): both 0 structural, the
  // 12B 3 real errors after reading and the 26B 5, the 12B 109.0 s and the 26B 57.7 s with a cold
  // load. The original's corpus was never committed, so these compare with the 26B only, not
  // with the original's numbers. Row facts from JW's audited seed.
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
      "12B dense (QAT) · 256k context · MEASURED on the rebuilt 40-key corpus: " +
      "0 structural, 3 real errors after reading (the 26B: 5) · about half the " +
      "26B's speed on an 8 GB card",
    notes: "The pick when the 26B doesn't fit (it needs ~24 GB RAM): as accurate on the rebuilt corpus, at about half the speed.",
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

// A catalog text revised between versions reaches an install that still holds the old one: the kit's
// modelCatalogHeals (5189ddb; app-structure §19 "An app's AI seed revised between versions") swaps a field only
// while it is exactly an old seeded value, so a user's own edit is never touched. Each old value is copied from git.
export const MODEL_CATALOG_HEALS = {
  // seeded 2026-08-06 → 2026-10-29, before the row's measurement
  "gemma-4-12b-qat": {
    description: ["12B dense (QAT) · 256k context · NOT yet measured on the translation corpus — expected to beat Gemma 3 12B (newer family, quantization-aware quant); measure to confirm"],
    notes: ["The 8-12 GB-card pick, pending its measurement run."],
  },
};

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

// The renderer's own origins: Quasar's dev server (its registered port, app-structure §1) and the
// desktop window (the shared Electron shell loads the UI from app://<id>) — without them every
// mutating call from the desktop app gets the CSRF 403, and CORS answers only these (and the
// phone's, the kit's CAPACITOR_ORIGINS).
export const APP_ORIGINS = ["http://localhost:1450", "http://127.0.0.1:1450", "app://just-ai-i18n-docgen"];

/**
 * Where the built UI is, for the headless server (null when there is none): JUST_AI_I18N_DOCGEN_UI_DIR;
 * a checkout's Quasar browser build, dist/spa/; or, packaged, the app folder — this package is
 * installed at <app>/node_modules/just-ai-i18n-docgen-server, so SOURCE_ROOT (two folders above
 * src/) is <app>/node_modules, and Quasar puts the built UI at <app> itself (resources/app.asar).
 */
export function locateUiDir() {
  const candidates = [];
  if (process.env.JUST_AI_I18N_DOCGEN_UI_DIR) candidates.push(process.env.JUST_AI_I18N_DOCGEN_UI_DIR);
  candidates.push(path.join(SOURCE_ROOT, "dist", "spa"));
  if (path.basename(SOURCE_ROOT) === "node_modules") candidates.push(path.dirname(SOURCE_ROOT));
  candidates.push(path.join(process.cwd(), "dist", "spa"));
  return candidates.find((c) => isDir(c) && existsSync(path.join(c, "index.html"))) ?? null;
}

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

/** installLlm's arguments — the same for the app and the routeless (CLI) boot. */
const llmArgs = (h, dataDir) => ({
  db: h,
  featureCatalog: FEATURE_CATALOG,
  featurePrompts: DEFAULT_FEATURE_PROMPTS, // one row per feature — see the header
  testSamples: DEFAULT_TEST_SAMPLES, // the Lab's Sample input for each row (seed_test_samples.js)
  enginePresets: DEFAULT_ENGINE_PRESETS,
  featurePresets: DEFAULT_FEATURE_PRESETS,
  defaultPresetId: DEFAULT_PRESET_ID,
  modelCatalogExtra: MODEL_CATALOG,
  modelCatalogHeals: MODEL_CATALOG_HEALS,
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
 * kit's routers are mounted as well (createApp's path; the backup/restore/reset router is
 * createApp's own, data_admin.js, behind the app's maintenance gate). Returns the data dir.
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
    app.route("/", runnerRouter());
    // The family /v1/prefs door: the renderer's prefs are `pref.*` rows in app_settings —
    // same DB, so the backup/restore/reset (data_admin.js) covers them.
    app.route(
      "/",
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
  // the app's own settings: the missing ones added, one still at an earlier default upgraded (settings.js)
  try {
    seedSettings(llmDb.session());
    upgradeSettings(llmDb.session());
  } catch (e) {
    log.warning(`the settings seed failed: ${errText(e)}`);
  }
  loadFromConfigs(stores.getProviderStore().list());
}

/** The writes that change what another window shows: a translation saved, accepted, undone or applied, a note, a
 *  run started or cancelled, the project's setup, the reviewer, the app's settings. Not one: a window's own prefs, a
 *  back-translation (a second opinion), a log line, the tokens. */
export const DATA_WRITES = /^\/v1\/(save|accept|undo|notes|proposals|setup|jobs|reviewer|settings)(\/|$)/;

/** The Hono app: the kit, the data/prefs/logs/disk routers, the workspace and the UI. */
export async function createApp(dataDir = null, configPath = null) {
  dataDir = dataDir ? purePath(String(dataDir)) : defaultDataDir();

  // Server logs → in-memory ring (the Settings → Logs viewer) + a per-day file that survives
  // a crash/boot-hang. Shared platform helpers, same in every app.
  installLogRing();
  installFileLog(path.join(dataDir, "logs", "just-ai-i18n-docgen.log"));

  // FastAPI's default error answers (a listed deviation — app-structure, Open deviations); an
  // unhandled exception gets the kit's family envelope (§15: problem+json with the request id).
  const app = createServer({ errors: "fastapi" });

  // Python's middleware order: CSRF outermost, then CORS, then auth. Hono runs middleware in
  // the order it is added and covers only the routes added after it, so the three come first,
  // in that order, before any router: a CSRF 403 carries no CORS headers; CORS answers
  // preflights before auth sees them and stamps auth's 401/403.
  //
  // A reverse proxy's public names (JUST_AI_I18N_DOCGEN_ALLOWED_HOSTS, comma-separated): the browser's Origin there
  // (https://docgen.example.com) is the server's own though the server sees another scheme and host behind the
  // proxy, and bearer auth's DNS-rebinding guard takes the name as this computer's (the template's app.js).
  const allowedHosts = (process.env.JUST_AI_I18N_DOCGEN_ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);
  const proxyOrigins = allowedHosts.flatMap((h) => [`https://${h}`, `http://${h}`]);
  // CSRF: reject cross-site browser mutations to /v1 (no token — can never lock anyone out).
  app.use("*", csrfOrigin({ appOrigins: APP_ORIGINS, extraOrigins: proxyOrigins, typeBase: TYPE_BASE }));
  // …and a READ the browser marks cross-site (Fetch Metadata — a cross-site <img> of /v1/data/backup made backups,
  // the kit's nineteenth review), but the app's own windows by their Origin and a navigation to the UI's pages —
  // the template's resourceIsolation, which docgen lacked until 2026-10-29.
  // Review's Google frame (GET /v1/gt-frame — an echo of the text it is given, no data) is the one page the app's
  // window frames; a frame carries no Origin, so it is named here (the kit's framePaths).
  app.use("*", resourceIsolation({ appOrigins: APP_ORIGINS, extraOrigins: proxyOrigins, typeBase: TYPE_BASE, framePaths: ["/v1/gt-frame"] }));
  // CORS answers the app's own origins only — the desktop window (app://), Quasar's dev server
  // (:1450), the phone's webview origins (the kit's CAPACITOR_ORIGINS) — which call :8742 DIRECTLY
  // (the kit's origin-aware resolver), so without them every request dies as a silent CORS block
  // (found live 2026-08-02 — no same-origin test can see it). The UI this server hosts is its own
  // origin and needs none. Never every origin: any web page the user opened could then read this
  // computer's server, backups and keys included (the template's app.js; the kit's security
  // review, 2026-10-19). The kit's Starlette 1.3.1 port.
  app.use("*", starletteCors({ allowOrigins: [...APP_ORIGINS, ...CAPACITOR_ORIGINS], allowMethods: ["*"], allowHeaders: ["*"] }));
  // Bearer auth — OFF unless tokens are configured (Settings → Server). Gates /v1/* only, and refuses a page that
  // renamed itself to reach this computer (DNS rebinding); the desktop shell's POST /v1/shutdown carries no token
  // and stays open from this machine (the route refuses anyone else itself).
  app.use("*", bearerAuth({ readAuth, typeBase: TYPE_BASE, loopbackOpenPaths: [SHUTDOWN_PATH], allowedHosts }));
  // While a restore or a reset replaces the data, every other window's write is refused (503,
  // Retry-After) and the ones already running finish first — never a save that lands half-way or
  // answers 200 and is lost (the kit's MaintenanceGate; the data router closes it). The shell's shutdown always
  // passes.
  const gate = new MaintenanceGate({ exempt: [SHUTDOWN_PATH] });
  app.use("*", gate.middleware());
  // Each window's writes that succeed are counted apart (the kit's ChangeCounter — its X-Client-Id), so the other
  // windows' pages read again (GET /v1/sync/rev); a restore and a reset are everyone's change (data_admin.js) — the
  // engines plan's F1, the template's.
  const changes = new ChangeCounter({ writes: DATA_WRITES, getSetting: getAppSetting, setSetting: setAppSetting });
  app.use("*", changes.middleware());

  // Awaited, so the stack is booted when createApp returns.
  await bootLlmStack(dataDir, app);
  // the data's epoch is kept in the database (a restore or a reset renews it)
  changes.useDatabase(llmDb.session());
  // Settings → Backups: backup / restore / reset (data_admin.js), behind the gate above.
  app.route("/", dataRouter(dataDir, { gate }));

  // Shared platform surfaces: the log ring's API and the read-only disk-usage route the
  // Settings → Storage panel reads.
  app.route("/", makeLogsRouter(PRODUCT));
  app.route("/", makeDiskRouter(dataDir));

  // The review workspace: starts with NO project (the setup screen creates one);
  // `configPath` pre-loads one for a configured launch. The handle lives in app_state (the
  // family setState/getState seam).
  const workspace = new Workspace(configPath);
  // A run's end is its window's change (the kit's JobRegistry onFinish — house-paint's): the others read again.
  setState(new AppState(dataDir, workspace, new JobRegistry({ onFinish: (job) => changes.note(job.clientId) }), { changes }));
  // The app's jobs — a translation run (jobs.js) — through the kit's routes: the running ones
  // (GET /v1/jobs?kind=translate), one (GET /v1/jobs/:id), its events (GET /v1/jobs/:id/events)
  // and its cancel (DELETE /v1/jobs/:id). The start is the workspace's POST /v1/jobs.
  app.route("/", makeJobsRouter(() => getState().jobs));
  app.route("/", healthRouter());
  // POST /v1/shutdown — the desktop shell's clean stop of this app's server it finds on its port
  // (src-electron/electron-main.js `shutdownPath`); the AI engine runs in this process's kill-on-close job and
  // ends with it (the template's).
  app.route("/", makeShutdownRouter());
  app.route("/", serverAuthRouter());
  app.route("/", makeSyncRevRouter(changes, { pollSeconds: () => getAppSetting(llmDb.session(), "windows.checkSeconds") }));
  app.route("/", settingsRouter());
  app.route("/", setupRouter());
  app.route("/", workspaceRouter());

  // Headless UI — the built UI (Quasar's dist/spa; the app folder when packaged), so the server +
  // a browser gives the full app without the desktop shell (the kit's origin-aware serverApi
  // targets window.location.origin). The kit's serveUi: a write to the UI's address 405 with
  // Allow, an unknown /v1 write the API's 404, ETags, Vite's hashed files kept, the rest
  // revalidated. Every /v1/* route above wins first (Hono runs routes in the order added).
  const uiDir = locateUiDir();
  if (uiDir !== null) {
    serveUi(app, uiDir);
    log.info(`UI served from ${uiDir}`);
  } else {
    log.warning("no built UI found — the headless UI is off. `npm run build:spa` makes dist/spa/, or set JUST_AI_I18N_DOCGEN_UI_DIR.");
  }

  return app;
}
