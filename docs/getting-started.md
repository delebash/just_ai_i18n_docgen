# Getting started

just_ai_i18n_docgen translates your app's i18n JSON locale files with an AI engine —
local or online — then **verifies every string it wrote** and puts a human review
workspace between the engine and your files.

## The one promise

**Nothing ships unseen.** A translation run stages *proposals*; your locale file is
byte-identical until you press Apply. The engine never signs anything off — every
acceptance is a human's click, stamped with a reviewer name and committed to git.

## Two doors, two run modes

- **The desktop app** — the window this doc lives in. `npm run dev` starts it; the
  Python server is spawned for you. (First time from source: create the server
  venv — the two commands are in the repo README.)
- **The command line** — the same brain with no window: `translate`, `check`,
  `escalate`, `accept`, `extract`. Both doors share one implementation of every
  decision, so a CLI run and an app run behave identically. See
  [The command line](cli.md).

The server can also run **headless**: start it yourself (`npm run server`, port
**8742**) and open the app in a browser — the built UI is served from the same
port. App data (the AI engine, downloaded models, logs) lives in a **`data` folder
inside the install directory** — the app is self-contained, so moving the
folder moves everything with it. You decide where it goes: relocate it from
Settings → Storage, or set `JUST_AI_I18N_DOCGEN_DATA_DIR` (or `--data-dir`) for
headless setups. Nothing is written to a hidden per-user location you didn't
pick; the only exception is an install directory that can't be written to
(Program Files, read-only media), where it falls back to the standard per-user
app-data folder so the app still starts. JustWrite and JustVoice follow the
identical rule.

## First launch

1. The boot splash may show a model bar — that's the app warming your default
   local AI model into memory so the first translation doesn't pay the load cost.
   **Continue** always skips straight into the app; the load finishes in the
   background.
2. If the window shows *"Can't reach the server"*, the Python server isn't
   running — in dev, start it with `npm run server` and press Retry.
3. On a fresh install the Home page is a welcome screen: **1 Point · 2 Translate ·
   3 Review.** Do those in order:
   - [Set up the AI engine](ai-providers.md) — pick or download a model.
   - [Point it at your app](project-setup.md) — tell the tool where your locale
     files live.
   - Then Home becomes your language dashboard and you can
     [run a translation](translate.md).
