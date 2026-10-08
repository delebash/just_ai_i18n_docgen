# just_ai_i18n_docgen — E2E test & screenshot harness

Automation over the REAL desktop app — Electron, the built UI from `app://` — through
Playwright's Electron driver (`playwright-core`; since the move off Tauri, 2026-10-08). The
wrapper lives in `lib/driver.js`; it keeps the old harness's `Driver` API, so the tests read
as before: `exec(script, args)` runs a WebDriver-style script body in the page (over the
debugger protocol, so the app's real Content-Security-Policy stays on), and every DOM helper
rides it.

## Prereqs

```bash
npm install                          # in e2e/ (playwright-core) and at the app root (electron)
npm run build:vite                   # from the app root — the harness drives the BUILT UI
```

No browser download and no driver binary: Playwright attaches to the Electron the app ships.

## Run what the USER runs

The server these scripts talk to must be **the app's own** — same data dir, same project,
same state you see in the window. **THE real project is JustWrite** (source
`justwrite-app/src/i18n/locales/en.json`, config `justwrite-app/just-ai-i18n-docgen/config.json`).
The server loads a project ONLY from `--config` at start or a live Setup save — nothing
persists across restarts — so start it as:

```bash
npm run server -- --config E:\Dev\Web\justwrite-app\just-ai-i18n-docgen\config.json
```

`npm run server` reads the same dev data folder the desktop app does (`data/` in this
checkout — one data-folder ladder), so no `--data-dir` is needed in development. A bare
`npm run server` boots UNLOADED (the 2026-08-04 lesson: three smoke runs failed on the
ConnectionError screen because of exactly that).

When a report comes in, verify against the data dir the app actually used — `data/` for
`npm run dev`, the folder beside the installed exe (or the one Settings → Storage names) for
the installed app — and read `<data>/logs/*.log` plus `<data>/ai-cache/llamacpp/logs/`.

## Scripts (run from the APP ROOT)

- `npm test` — the smoke suite: the real app, BEHAVIOUR assertions (the AI-tasks toggle stays
  open, the wizard opens a real dialog with the translation catalog, Home shows staged work).
  **Needs a server on :8742 with YOUR real project loaded** (above) — the suite reads live
  endpoints. `JAID_DEV_NO_SIDECAR=1` keeps the app from starting (or evicting) a server.
  **Cadence** (user ruling 2026-08-05): this suite is a PRE-COMMIT gate, not a per-change one.
  Per-change verification is the fast gates (`npm run lint`, `npm run test:server`,
  `npm run build:vite` — seconds), then ONE suite run before the commit.
  **One test writes**: "quick setup RUNS" drives the real wizard, so it writes the engine
  presets (that write IS the assertion — a wizard that corrupts routing must fail here) and
  then restores them, verifying the restore. It also starts a real load and cancels it.
- `npm run screenshots` — captures every surface as PNGs into `e2e/shots/` (gitignored).
  Start the server on :8742 first if you want shots with data; `CAPTURE_NO_SIDECAR=0` lets
  the app start its own server instead.

## Gotchas

- The harness drives whatever `dist/` was last built — rebuild after renderer changes.
- Don't run capture while your own dev window is open on the same server.
