# Just AI i18n & DocGen

A desktop app that translates your app's standard i18n JSON locale files with an AI engine you choose — the **built-in engine** (llama.cpp, bundled) on your own computer, or an online provider — then **verifies every string it wrote** and puts a review workspace between the engine and your files. Nothing ships unseen: a run stages proposals, and your locale file is byte-identical until you press Apply. It also turns your help docs' front matter into locale keys, so the help ships translated too.

Built with **Quasar (Vue 3) in Electron mode**, over a local **Node (Hono) server** on port 8742 that owns all the data, with the family's shared kit (`../just-core`) for everything engine-shaped — plain JavaScript end to end (since 2026-10-08; it was Tauri + Python before).

User docs live in `docs/` (the in-app Help). The website at <https://delebash.github.io/just-ai-i18n-docgen-website/> mirrors them for each release.

---

## Quick start

```bash
npm install            # the renderer + the server/ workspace (the kit ../just-core sits beside this repo — see Setup)
cd src-electron && npm install && cd ..   # once: the desktop app's own packages (Electron)
npm run dev            # Quasar's dev server on :1450 + the desktop window; the window starts the server on data/
npm run build          # the installer for the current OS, in dist/electron/Packaged/
```

A fresh install opens on a welcome screen — **1 Point · 2 Translate · 3 Review**: set up the AI engine, point it at your app, run a translation.

---

## Features

### ✶ Translate — a run that only proposes

- **A language dashboard.** Home is one row per target language with progress, a status chip and the last run. Tick languages and press **Translate**; they run one after another.
- **Proposals, not writes.** A run stages proposals. The locale file is byte-identical until you press **Apply** — and applying is undoable.
- **Shielded strings.** Placeholders, glossary terms and markup are swapped for tokens the model can't break; a string whose shield comes back damaged is retried, never written.
- **Your rules ride along.** Per-language conventions and your per-key notes go into every prompt.
- **Scopes.** *Pending* is every missing key plus every flagged one (the dashboard's button); the **Runs** page adds *flagged*, *unsure* and *all*, and the run history.
- **Nothing silently skipped.** Cancel keeps the staged work; one job runs at a time; a key that fails every retry is named at the end of the run.
- **One task surface.** A run shows on the dashboard's strip and in the title bar's AI-tasks panel, beside model downloads, with Cancel.

### ✶ Verify — every string checked, four ways

- **Offline checks.** Placeholders, plural halves, glossary, punctuation edges (¿…? in Spanish), numbers, brackets, doubled words, whitespace — deterministic, no engine. A translation that adds plural forms is checked form by form.
- **The probe.** Re-translates a sample with the same engine and flags where the two passes disagree; it refuses to run at temperature 0 (CLI: `translate --probe`).
- **The confirmation pass.** Asks the engine, one key at a time, only about targets identical to their source, and pre-ticks the ones it confirms. It never writes an acceptance.
- **Terminology.** A key that renders a term differently from the rest of your catalogue gets an advisory flag.
- **Escalation.** Re-translate only the stubborn keys with a stronger preset (CLI: `escalate <config> <preset-id>`); what the everyday model got right stays untouched.

### ✶ Review — nothing ships unseen

- **A queue that sorts the work.** Buckets with live counts — *Needs review*, *Unsure*, *Terminology*, *Missing*, *Came back identical*, *Proposed*, *All flagged*, *Accepted* — a per-check breakdown, and search.
- **Everything beside the string.** Why it's flagged in plain words, the source with placeholders marked, the engine's proposal, a Google Translate second opinion, a back-translation, the namespace siblings, the note box.
- **The staged pile.** **Apply all** writes `<lang>.json` and re-runs the checks on what was written; **Discard** drops the proposals (undoable too).
- **Acceptances that expire.** An acceptance covers one exact pair of strings — key, flag, source and target; change either side and the finding comes back. Each is stamped with the reviewer's name, in `<lang>.accepted.json`, committed. **Un-accept** takes one back.
- **One undo per click.** Undo reverts the last action — even applying two thousand proposals at once.
- **Bulk where it's honest.** In *Came back identical*, tick rows (or the engine's suggested ones) and approve them in one click, one undo.
- **Notes teach the next run.** A note on a key rides into that key's next translation (`<lang>.notes.json`, committed).
- **The keyboard.** `j`/`k` move · `a` accept · `u` undo · `e` edit · `g` Google panel · `b` back-translate · `/` search.

### ✶ Setup — one fact about your app

- **Point, then check.** Give it the path to your source locale file (usually `en.json`). **Check path** reports the key count, the placeholder syntax, the plural separator, the locale files already there and how done each is, and glossary candidates — writing nothing.
- **Languages, context, glossary.** Target languages, one sentence about your app (it rides every prompt), and the terms never to translate.
- **Your files, in your repo.** **Save project** writes `just-ai-i18n-docgen/config.json` beside your app's `package.json` and loads it without a restart, and prints the `.gitignore` lines for your repo. Every path resolves against that config file, never the working directory.

### ✶ Help docs → locale keys

- **Write once.** A help page's front matter — `lede:` and `hints:` — becomes `lede.<page>` and `hints.<page>.<field>` keys that translate, review and verify like any other.
- **A CI gate.** `extract --check` fails when the docs and the keys drift. YAML it doesn't support is refused loudly, never guessed.

### ✶ Command line — the same brain, no window

- **Five commands.** `translate`, `check`, `escalate`, `accept`, `extract` — `check` exits 1 on failures, so it gates CI.
- **One implementation, two doors.** The CLI and the app share every decision; a CLI run shows up in Review exactly like an app run.
- **Installed with the app.** `just-ai-i18n-docgen <command> <config>` and `just-ai-i18n-docgen-server serve` sit beside the exe (on macOS in `Contents/Resources`) and run on it — nothing else to install.

### ✶ AI — local or online

- **A built-in local engine.** **Quick Setup** checks your computer, proposes a model that fits, and downloads llama.cpp and the model with progress and Cancel — private and free.
- **Measured models only.** The catalog lists models this tool's checks were run against (a model that writes lovely prose can still mangle placeholders).
- **Any provider.** OpenAI, Anthropic and Gemini directly, or any OpenAI-compatible server — Ollama, LM Studio and more.
- **Routing by feature.** *Translate*, *review* (back-translation) and *confirm* each point at their own engine preset; the Lab shows the real prompt the pipeline builds.
- **Safe engine updates.** A new llama.cpp build is checked — it starts and accepts the app's settings — before it replaces yours.
- **Shared downloads.** If JustWrite or JustVoice already downloaded models on this computer, it offers to share them instead of downloading again.

### ✶ Cross-cutting

- **Headless when you want.** The server serves the whole app to a browser (port 8742), behind access tokens when it's exposed, and can keep running in the tray after the window closes.
- **One data folder.** App data (the engine, models, logs, the database) sits in a `data` folder inside the install directory; **Settings → Storage** moves it.
- **Backups.** A ZIP of the app's own data (connections, presets, the reviewer name), restore, and reset — your locale files and review records stay in your project.
- **English and Spanish.** Every screen — and docgen's own Spanish was translated with docgen and reviewed before it shipped.

---

## Setup

### Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| **Node 24+** | npm, the renderer build, the scripts | <https://nodejs.org/> |
| **The kit** | `../just-core` beside this repo — the server package (`file:../just-core/packages/core`) and the Vue kit (the alias to `../just-core/packages/ui/src` in `quasar.config.js`) | `git clone https://github.com/delebash/just-core ../just-core`, then `cd ../just-core/packages/core && npm install` and `cd ../ui && npm install` |
| **gh CLI** | Starting the release workflow only | <https://cli.github.com/> + `gh auth login` |

Electron comes in through `src-electron/`'s `npm install`; the server and its tests run on Electron's own Node (`scripts/node24.js`), so nothing else is needed — no Python, no Rust.

### One-time

```bash
npm install                      # the renderer + the server/ workspace
cd src-electron && npm install   # the desktop app's own packages (Electron)
cd e2e && npm install            # only for the e2e smoke and the screenshots (playwright-core)
```

---

## NPM scripts

Run from the repo root.

| Script | What it does |
|---|---|
| `npm run dev` | The desktop app — Quasar's dev server on :1450 (HMR on :1451) and the Electron window; the window starts the server on the dev data folder `data/`. |
| `npm run dev:spa` | The renderer alone in a browser tab at `http://localhost:1450` — start the server yourself (`npm run server`). |
| `npm run server` | The server alone (headless) on :8742, on `data/`, with the built UI at `/` (`--host`, `--port`, `--data-dir`, `--config <project config>` after `--`). |
| `npm run build` | The installer for the current OS (Quasar's Electron mode, electron-builder) → `dist/electron/Packaged/`. |
| `npm run build:spa` | The browser build (`dist/spa/`) — what the headless server serves. |
| `npm run build:unpacked` | The desktop app built, not packaged (`dist/electron/UnPackaged/`) — what `npm test` drives. |
| `npm run cli -- <command> <config>` | The CLI: `translate` · `check` · `escalate` · `accept` · `extract`. |
| `npm run test:server` | vitest over `server/tests/`, on Electron's Node. |
| `npm run test:unit` | vitest over the renderer. |
| `npm test` | The e2e smoke: the REAL desktop app through Playwright's Electron driver (`npm test --prefix e2e`). |
| `npm run screenshots` | Every surface shot from the real window → `e2e/shots/` (gitignored). |
| `npm run lint` | Biome. |
| `npm run i18n:lint` · `i18n:report` | No word written into a template or built in code (must be 0) · keys used but missing from the English catalog (must be none). |
| `npm run bump <version>` | The version in `package.json`, `server/package.json` and the lockfile (`npm version`). Doesn't commit or tag. |
| `npm run release -- [version]` | Starts the release workflow (`gh workflow run`) — `--platform windows\|macos\|linux`, `--yes` to skip the question. |

The family guard, `node ../just-core/scripts/check-family.js`, must pass before a commit, beside `npm run lint && npm run test:server && npm run test:unit`.

---

## E2E harness (smoke tests + screenshots)

Lives in `e2e/` — automation over the real desktop app (Electron, the built UI from `app://`) through Playwright's Electron driver (`playwright-core`); [`e2e/README.md`](e2e/README.md) has the full story.

```bash
cd e2e && npm install          # once — no browser download, no driver binary
npm run build:unpacked         # the harness drives the BUILT desktop app
npm run server -- --config <your app>/just-ai-i18n-docgen/config.json   # the real project, on :8742
npm test                       # the smoke suite
npm run screenshots            # → e2e/shots/
```

- **Real data, real project.** The suite reads live endpoints, so the server must have your real project loaded — a bare `npm run server` boots with none. One test drives the real Quick Setup and writes the engine presets, then restores them.
- **Cadence.** The suite is a pre-commit gate; per change, run the fast gates (lint, `test:server`, `build:spa`).
- **Rebuild first.** It drives whatever `dist/electron/UnPackaged` was last built.
- **Close your dev window.** Don't run it while your own window is open on the same server.

---

## Release process

Manual, as JustWrite's: pushes and tags never start a build.

```bash
# 1. Bump the version (package.json, server/package.json, package-lock.json)
npm run bump 0.2.0

# 2. Write the "## v0.2.0" section in docs/whats-new.md (the release notes), then commit, tag, push
git commit -am "Release v0.2.0"
git tag v0.2.0
git push && git push origin v0.2.0

# 3. Start the build
npm run release              # every platform
npm run release -- --platform windows
```

`scripts/release.js` checks first — the gh CLI is signed in, the tag is on origin, `docs/whats-new.md` has the version's section, and the kit's commit you built with is on origin — and passes that kit commit to the workflow. What `.github/workflows/release.yml` does:

1. Builds the Windows installer (NSIS), the macOS .dmg and .zip, and the Linux AppImage on per-platform runners, each with the kit checked out beside the app at that commit.
2. Starts each packaged app as a user would, its server on its own through the launcher, and checks both use one data folder; opens the AppImage on Ubuntu 24.04.
3. Only when every check passed: creates the GitHub release `v<version>` (a draft until every file is attached) with the installers and electron-updater's feed (`latest*.yml`, the `.blockmap`s).
4. Packs the user docs (`docs/*.md`, `docs/toc.json`) into `docs.tar.gz` and attaches it while the release is still a draft.
5. Dispatches `docs-updated` to the website repo (`WEBSITE_REPO` at the top of the workflow: `delebash/just-ai-i18n-docgen-website`), which rebuilds from those docs.

`gh workflow run release.yml -f tag=main -f publish=false` is a dry run: the same builds, kept on the run instead of released.

> The **`WEBSITE_DISPATCH_TOKEN`** secret (a fine-grained token on the website repo with Contents read and write) drives step 5. Without it the step logs a skip, and the site picks the docs up on its next build. The workflow is the kit template's, as it is (`../just-core/template/.github/workflows/release.yml`) — only `WEBSITE_REPO` is docgen's.

---

## Project structure

```
just_ai_i18n_docgen/           ← a Quasar app (the family layout: the kit's docs/app-structure.md §Q)
├── AGENTS.md                  ← the working rules and pointers for any AI (CLAUDE.md imports it)
├── README.md
├── docs/                      ← the user docs (the in-app Help; docs.tar.gz on release), indexed by toc.json
│   ├── dev/                   ← README.md (start here) · TASKS.md · IDEAS.md · RESEARCH.md · agentic-review.md
│   └── plans/                 ← dated plans (archive/ = closed history)
├── quasar.config.js           ← the one build config: the renderer, the desktop app, the installer
├── index.html                 ← the CSP and the static boot plate
├── biome.json                 ← the linter
├── eslint.i18n.config.js      ← the family's i18n lint (npm run i18n:lint)
├── scripts/
│   ├── node24.js              ← runs a script on Electron's own Node (the server's runtime)
│   ├── bump.js · release.js   ← the version; starting the release workflow
│   ├── start-packaged.js      ← the release's check of a packaged app
│   └── review/                ← the agentic translation review's steps (docs/dev/agentic-review.md)
├── src-electron/              ← the desktop app (Quasar's Electron mode; its own package.json)
│   ├── electron-main.js       ← the kit's runDesktopApp with this app's settings
│   ├── electron-preload.js    ← the kit's preload
│   └── electron-assets/icons/ ← app and tray icons
├── build/launcher/            ← the CLI and headless-server launchers, installed beside the exe
├── e2e/                       ← the smoke suite and the screenshots (its own package.json)
├── server/                    ← the server (Node, Hono, :8742) — its own package, just-ai-i18n-docgen-server
│   ├── src/                   ← serve.js (the entry) · app.js · api/ (one file per area) · the domain
│   │                            modules: checks, shieldlib, loop, engine, workspace, state, confirm, extract, cli …
│   └── tests/                 ← vitest
├── src/                       ← the Vue renderer
│   ├── boot/                  ← docgen.js (wires the kit's UI) · i18n.js (vue-i18n)
│   ├── App.vue                ← a bare <router-view>
│   ├── layouts/MainLayout.vue ← the chrome: the title bar, the sidebar, the page
│   ├── pages/                 ← one <Name>Page.vue per route; ConnectionErrorPage at /offline
│   ├── router/ · stores/      ← routes.js · Pinia stores (project, review, jobs, ui)
│   ├── services/              ← native.js (the desktop shell's calls) · langs.js · helpDocs.js …
│   ├── css/                   ← tokens.css · app.scss · quasar.variables.scss
│   └── i18n/locales/          ← en.json · es.json
├── just-ai-i18n-docgen/       ← docgen's own project (its catalog translated by docgen)
└── data/                      ← the dev data folder (gitignored): the database, the engine, models, logs
```

---

## How the desktop shell is reached

The renderer reaches the desktop shell through ONE file, `src/services/native.js`: ordinary exports (`pickDirectory`, `storageGetRoot`, `storageRelocate`, `shellServerStatus`, `setKeepRunning`, `setTrayLabels`, `setContextMenuLabels`, `openUrl`, `openPath`, `onShellEvent`, `desktopUpdater`), each calling the kit's preload object `window.appShell`. The shell itself is the kit's shared Electron main module (`@delebash/core/shell`); `src-electron/electron-main.js` only names this app's settings — its id, port 8742, the server entry, the data-folder variable `JUST_AI_I18N_DOCGEN_DATA_DIR`. The window loads from `app://just-ai-i18n-docgen`, which the server's CORS and CSRF both allow. Outside the desktop app (a browser tab on `npm run dev:spa`, or the headless server's UI) every call answers the browser's way — null or a no-op.

A new shell command goes into the kit (its command list in `just-core/packages/core/src/shell/main.js` and `preload.js`), then is exported once from `native.js`.

---

## AI providers

AI runs through the family's **shared LLM stack** (`../just-core`): `server/src/app.js` mounts the kit's runner router and calls `installLlm`, which mounts the providers, routing, presets and usage API (`/v1/llm-providers`, `/v1/ai/*`), with official-SDK adapters for OpenAI, Anthropic and Gemini plus the OpenAI-compatible shape for local servers. The renderer's **AI Settings** page is the kit's `AiModelsArea`. The bundled llama.cpp runner downloads, tunes and serves local GGUF models — no separate install.

This app registers three features — `translate`, `review`, `confirm` — each routed to an engine preset that owns the provider, model, temperature and think settings (`DEFAULT_ENGINE_PRESETS` in `server/src/app.js`). It builds its own prompts (shielding is a substitution — `server/src/shieldlib.js`), so the kit's prompt store carries none, and its model catalog is translation-measured rows only (`MODEL_CATALOG`). Project configs carry no engine field: the engine seam (`server/src/engine.js`) resolves the feature's preset, the same for the app and the CLI.

---

## Working with Claude Code

This repo is developed with [Claude Code](https://claude.com/claude-code), Anthropic's CLI.

### Project context

- **`AGENTS.md`** (which `CLAUDE.md` imports) is the brief: the commands and gates, the "what bites" list — a job writes only proposals, the engine never signs off, shielding is a substitution, one resolver, every path anchored to the config file — the layout, and the family rules.
- **`docs/dev/`** — `README.md` (the reading order), `TASKS.md` (the live tracker), `IDEAS.md` (the backlog), `RESEARCH.md` (what is already known, with the proof — read its section before researching).
- **`docs/`** is the user-facing reference, mirrored to the website. A change a user can see updates it in the same commit.
- **The real project** this tool translates is JustWrite's catalog (`justwrite-app/src/i18n/locales/en.json`, config `justwrite-app/just-ai-i18n-docgen/config.json`) — test against it, not a sandbox.

### The agentic translation review

Claude Code agents can review a language's translations in the MQM way while docgen's own routes apply the result — nothing ships without passing docgen's checks, every write is undoable, and acceptances are recorded under a named reviewer. The steps are `scripts/review/*.js` and the saved workflows `.claude/workflows/translation-*.js`; how to run a review is [`docs/dev/agentic-review.md`](docs/dev/agentic-review.md).

### Checking a change

A change is done when `npm run lint && npm run test:server && npm run test:unit` and the family guard (`node ../just-core/scripts/check-family.js`) pass. A change a user can see also passes `npm run i18n:lint`, updates `docs/*.md`, and passes `npm run build:unpacked && npm test` on the real desktop app — the acceptance surface; never a Chrome tab.

---

## License

MIT — see [`LICENSE`](LICENSE); every source file carries `SPDX-License-Identifier: MIT`. Code copied or ported from other projects, with its licence, is listed in [`NOTICE.md`](NOTICE.md). Models and APIs are subject to their providers' terms.
