# just_ai_i18n_docgen

Translate standard i18n JSON locale folders with a local or online AI engine, VERIFY
every string that was written, and author help docs whose front-matter becomes locale
keys — with a human review workspace where nothing ships unseen. A rewrite of
`just-ai-help`, embedding `just-llm-runner` for everything engine-shaped. **Electron +
a Node (Fastify) server since 2026-10-08** — the first family app off Tauri and Python
(JustVoice's `docs/plans/2026-10-07-electron-node-plan.md` §5). **A Quasar app since
2026-10-09** — its Electron mode is the desktop app (the kit's `docs/app-structure.md` §Q).

**The family structure standard lives in `../just-llm-runner/docs/app-structure.md` —
read it before changing layout, scripts, ports, or the shell. This app is the standard's
reference implementation.**

## Commands

```bash
npm run dev            # THE APP — Quasar's dev server on :1450 (HMR 1451) + the Electron window; the window starts the server
npm run dev:spa        # the renderer alone in a browser tab at :1450 (start the server yourself: npm run server)
npm run server         # the server alone on :8742 (server/src/serve.js on Electron's Node), UI at /
npm run test:server    # the server's tests — vitest on Electron's own Node 24
npm run build:spa      # the browser build (dist/spa), what the headless server serves
npm run test:unit      # the renderer's unit tests
npm run build:unpacked # the desktop app built, not packaged (dist/electron/UnPackaged) — what npm test drives
npm test               # e2e smoke: the REAL desktop app via Playwright's Electron driver (build:unpacked first)
npm run screenshots    # every surface shot from the real window → e2e/shots/
npm run build          # the installer (Quasar's Electron mode, electron-builder → dist/electron/Packaged)
npm run lint           # biome

# The CLI door (same service functions as the workspace — one resolver, two doors):
npm run cli -- translate|check|escalate|accept|extract <config>
```

The dev data folder is `data/` in this checkout (gitignored) — the desktop app and
`npm run server` read the same one (the kit's one data-folder ladder). The shell is the
kit's `@delebash/llm-runner/shell` (`runDesktopApp`); `src-electron/electron-main.js` only names
this app's settings. The installer ships `just-ai-i18n-docgen-server` and `just-ai-i18n-docgen`
(the CLI) as launchers beside `just_ai_i18n_docgen.exe` — the app's own exe run as Node.
**A launcher is never named like the exe**: Windows resolves a bare name to the exe first.

## What bites

- **A job writes ONLY proposals.** The locale file is byte-identical when a run
  finishes; applying is a human's click. One job at a time; cancel keeps staged work.
- **The engine never signs off.** The confirmation pass PRE-TICKS rows in workshop
  state; `<lang>.accepted.json` is the human record, hash-expiring over
  (key, code, source, target), reviewer named — never the OS username.
- **Shielding is a substitution, not an instruction** (`shieldlib.js`). A restored
  string missing a token is a FAILURE routed to retry; keys are never silently
  skipped — the exhausted ones are NAMED and the exit code is non-zero.
- **One resolver.** The engine's send (`engine.js`) resolves the feature's ENGINE PRESET (shared
  DB, one-source: provider+model+temperature/think). Configs carry NO engine field.
  The probe's temperature-0 guard reads the RESOLVED preset.
- **Hand adapters the OpenAI `response_format` shape** — they own per-provider
  translation. A hand-built `format` key was routed into Ollama's `options` and
  ignored; found live, 6/6 keys exhausted (2026-08-02).
- **Every path anchors to the CONFIG FILE**, never the cwd (`paths.js` — the
  27-minute/464-key cache lesson). Committed per-project text: `config.json`,
  `<lang>.accepted.json`, `<lang>.notes.json`. Workshop state:
  `.just-ai-i18n-docgen-state.json` (atomic writes; a corrupt file costs
  state, never work).
- **A database transaction never spans an `await`** — the server holds ONE synchronous
  SQLite connection (better-sqlite3); a transaction that awaited would let another
  request's statements land inside it. `installLlm`'s tests use file-backed databases
  as the Python did.
- **Everything is `/v1/*`** — app routes beside the shared stack's, the family
  convention. `/api` was a Node-era habit, corrected 2026-08-02.
- **`checks.js` carries the NUL-byte war story** — the separator is the four-char
  escape `\x00`; a literal NUL made the first JS original binary-to-git and broke the
  Python port's first write too. Never type a literal NUL into a source file.
- **The real desktop app is the acceptance surface — and it keeps finding bugs no test
  can.** Four in two days under Tauri, each invisible from the route tests and vite:
  missing CORS (the resolver hits :8742 directly from dev), `/summary` counting backlog
  as findings, a driver/webview version mismatch, and `configureLlmUi({})` falling back
  to the window's own origin so every kit LLM view rendered empty IN PRODUCTION ONLY.
  The window now loads from `app://just-ai-i18n-docgen`, which the server's CORS and
  CSRF must both allow. Verify with `npm run screenshots` / `npm test`, never with a
  Chrome tab (user ruling 2026-08-02; browser driving is banned).
- **The standard app chrome is mandatory** (`app-structure.md` §11): `/ai` =
  kit `AiModelsArea`, `AiStatusButton` in the TitleBar (JW parity — the smoke
  asserts it), Settings =
  appearance/storage/server/logs/reviewer/about (Server = the headless/token
  section, ruling 2026-08-04), server wires the platform log ring +
  file log + logs/disk routers. This app shipped without ALL of it once
  (2026-08-02) — that is why the section exists.

## Layout

Per the standard's Quasar layout (§Q, the move 2026-10-09): `quasar.config.js`, `index.html` +
`src/` (the Vue renderer: the boot file `src/boot/docgen.js` instead of a `main.js`, the root
`src/App.vue` choosing the shell `AppShell.vue` or the connection-error screen,
`router/routes.js`, `stores/index.js`), `src-electron/` (`electron-main.js` = the shell's
settings, the preload, the icons in `electron-assets/icons/`), the server its own package in
`server/` (`just-ai-i18n-docgen-server`, an npm workspace; the headless UI from `dist/spa`, the
app folder when packaged) — domain modules flat, HTTP routes one file per area under `api/`
(`health_api.js`, `server_auth_api.js`, `setup_api.js`, `workspace_api.js`), with
`serve.js`/`app.js`/`app_state.js`/`version.js` the family server skeleton — tests in
`server/tests/*.test.js`, `build/launcher/` (the launchers), `data/` (dev data, gitignored).
The server kit is the npm dependency `@delebash/llm-runner` (`file:../just-llm-runner/server`);
the UI kit is consumed via the alias to `../just-llm-runner/ui/src` in `quasar.config.js`. The
renderer reaches the shell only through
`src/services/native.js` (the one reader of `window.appShell`).
Port **8742** (JW 17495 · JV 17494). Data-dir env: `JUST_AI_I18N_DOCGEN_DATA_DIR`.

## Where to look

**Before researching anything — reading code to answer a question, measuring, briefing an agent — read the subject's section of `docs/dev/RESEARCH.md`** (what is already known, with the proof; the shared stack's facts are in `../just-llm-runner/docs/dev/RESEARCH.md`; the family rule, 2026-10-04). Research isn't done until its facts land there.

| For | Read |
|---|---|
| **THE REAL PROJECT — what this tool translates** | JustWrite: source `E:\Dev\Web\justwrite-app\src\i18n\locales\en.json`, config `justwrite-app/just-ai-i18n-docgen/config.json` (the app creates it via Setup; the server loads it via `--config` or a live Setup save — nothing persists across restarts) |
| Open work — the live tracker | `docs/dev/TASKS.md` |
| The family structure standard (layout/scripts/shell/ports) | `../just-llm-runner/docs/app-structure.md` |
| Adopting the shared LLM stack | `../just-llm-runner/server/README.md` "Consume it" |
| The measured evidence behind every check and rule | the retired Node original: https://github.com/delebash/just-ai-help (docs/HANDOFF.md; archived) |
| The review workspace API surface | `server/src/api/workspace_api.js` (routes) + `server/src/workspace.js` (the Workspace class + write rules) |

Read branch and working-tree state from git, never from a doc.
