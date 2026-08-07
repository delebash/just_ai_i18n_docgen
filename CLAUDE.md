# just_ai_i18n_docgen

Translate standard i18n JSON locale folders with a local or online AI engine, VERIFY
every string that was written, and author help docs whose front-matter becomes locale
keys — with a human review workspace where nothing ships unseen. The Python rewrite of
`just-ai-help`, embedding `just-llm-runner` for everything engine-shaped.

**The family structure standard lives in `../just-llm-runner/docs/app-structure.md` —
read it before changing layout, scripts, ports, or the shell. This app is the standard's
reference implementation.**

## Commands

```bash
npm run dev            # THE APP — desktop window; spawns the Python server itself
npm run dev:vite       # browser-only dev at :1420 (start the server yourself: npm run server)
npm run server         # the Python server on :8742 (venv-resolved via scripts/py.js)
npm run test:server    # pytest — 148 tests
npm test               # e2e smoke: the REAL app via tauri-driver (build release first)
npm run screenshots    # every surface shot from the REAL WebView2 → e2e/shots/
npm run tauri build -- --no-bundle   # the release exe the e2e harness drives
npm run build:vite     # the web build (dist/ is gitignored — the exe embeds it)
npm run lint           # biome over src/
cd server && .venv/Scripts/python -m ruff check just_ai_i18n_docgen tests

# The CLI door (same service functions as the workspace — one resolver, two doors):
server/.venv/Scripts/just-ai-i18n-docgen translate|check|escalate|accept|extract <config>
```

## What bites

- **A job writes ONLY proposals.** The locale file is byte-identical when a run
  finishes; applying is a human's click. One job at a time; cancel keeps staged work.
- **The engine never signs off.** The confirmation pass PRE-TICKS rows in workshop
  state; `<lang>.accepted.json` is the human record, hash-expiring over
  (key, code, source, target), reviewer named — never the OS username.
- **Shielding is a substitution, not an instruction** (`shieldlib.py`). A restored
  string missing a token is a FAILURE routed to retry; keys are never silently
  skipped — the exhausted ones are NAMED and the exit code is non-zero.
- **One resolver.** `engine.make_send` resolves the feature's ENGINE PRESET (shared
  DB, one-source: provider+model+temperature/think). Configs carry NO engine field.
  The probe's temperature-0 guard reads the RESOLVED preset.
- **Hand adapters the OpenAI `response_format` shape** — they own per-provider
  translation. A hand-built `format` key was routed into Ollama's `options` and
  ignored; found live, 6/6 keys exhausted (2026-08-02).
- **Every path anchors to the CONFIG FILE**, never the cwd (`paths.py` — the
  27-minute/464-key cache lesson). Committed per-project text: `config.json`,
  `<lang>.accepted.json`, `<lang>.notes.json`. Workshop state:
  `.just-ai-i18n-docgen-state.json` (atomic writes; a corrupt file costs
  state, never work).
- **`install_llm` never gets a single-shared-connection test DB** — the backfill
  daemon thread interleaves with seeding and silently rolls it back. File-backed
  SQLite in tests.
- **Everything is `/v1/*`** — app routes beside the shared stack's, the family
  convention. `/api` was a Node-era habit, corrected 2026-08-02.
- **`checks.py` carries the NUL-byte war story** — the separator is the four-char
  escape `\x00`; a literal NUL made the JS original binary-to-git and then broke this
  port's first write too. Python's compiler is the tripwire now.
- **The real webview is the acceptance surface — and it keeps finding bugs no test
  can.** Four in two days, each invisible from TestClient/vite: missing CORS (the
  resolver hits :8742 directly from dev), `/summary` counting backlog as findings,
  msedgedriver must match the WEBVIEW2 RUNTIME version (not Edge's), and
  `configureLlmUi({})` falling back to `tauri.localhost` as its base so every kit
  LLM view rendered empty IN PRODUCTION ONLY. Verify with `npm run screenshots`,
  never with a Chrome tab (user ruling 2026-08-02; browser driving is banned).
- **The standard app chrome is mandatory** (`app-structure.md` §11): `/ai` =
  kit `AiModelsArea`, `AiStatusButton` in the TitleBar (JW parity — the smoke
  asserts it), Settings =
  appearance/storage/server/logs/reviewer/about (Server = the headless/token
  section, ruling 2026-08-04), server wires the platform log ring +
  file log + logs/disk routers. This app shipped without ALL of it once
  (2026-08-02) — that is why the section exists.

## Layout

Per the standard: untouched create-tauri-app root (`index.html`, `src/`, `src-tauri/`),
Python in `server/just_ai_i18n_docgen/` — domain modules flat at the package root, HTTP
routes one file per area under `api/` (`health_api.py`, `server_auth_api.py`,
`setup_api.py`, `workspace_api.py`), with `serve.py`/`app.py`/`app_state.py`/`version.py`
the family server skeleton (`../just-llm-runner/docs/target-tree.md`, P4 2026-08-08 —
supersedes the earlier flat-package ruling). Tests in `server/tests/`, kit consumed via
the Vite alias to `../just-llm-runner/ui/src`.
Port **8742** (JW 17495 · JV 17494). Data-dir env: `JUST_AI_I18N_DOCGEN_DATA_DIR`.

## Where to look

| For | Read |
|---|---|
| **THE REAL PROJECT — what this tool translates** | JustWrite: source `E:\Dev\Web\justwrite-app\src\i18n\locales\en.json`, config `justwrite-app/just-ai-i18n-docgen/config.json` (the app creates it via Setup; the server loads it via `--config` or a live Setup save — nothing persists across restarts) |
| Open work — the live tracker | `docs/dev/TASKS.md` |
| The family structure standard (layout/scripts/shell/ports) | `../just-llm-runner/docs/app-structure.md` |
| Adopting the shared LLM stack | `../just-llm-runner/README.md` "Consume it" |
| The measured evidence behind every check and rule | the retired Node original: https://github.com/delebash/just-ai-help (docs/HANDOFF.md; archived) |
| The review workspace API surface | `server/just_ai_i18n_docgen/api/workspace_api.py` (routes) + `workspace.py` (the Workspace class + write rules) |

Read branch and working-tree state from git, never from a doc.
