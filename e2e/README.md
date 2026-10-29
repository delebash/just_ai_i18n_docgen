# just_ai_i18n_docgen — E2E test & screenshot harness

Automation over the REAL desktop app — Electron, the built UI from `app://` — through Playwright's Electron
driver (`playwright-core`). It drives Quasar's built desktop app before packaging, `dist/electron/UnPackaged`,
with the checkout's Electron (`src-electron/node_modules`). The driver is the template's
(`../just-core/template/e2e/lib/driver.js`, only this app's constants differ — app-structure §10, §18), since
2026-10-29.

## Hermetic

Every run is its own world (app-structure §18):

- a temp data folder, with `JUST_AI_HOME` pointed inside it — nothing reads or writes your data or the family's
  cache registry;
- the harness starts the app's own server on that folder (from source, on Electron's Node — `scripts/node24.js`)
  and stops it after (`POST /v1/shutdown`);
- the window runs with `JUST_AI_I18N_DOCGEN_DEV_NO_SERVER=1`, so the shell never starts, evicts or strands a
  server of its own; a run refuses to start while something already listens on 8742 (your dev server, say);
- the project is the suite's own, `lib/fixture.js`: a small app with Spanish part done (two identical strings,
  two never translated) and French not started, its run's output staged — loaded the way Setup's Save loads one.
- no real model and no network, unless `JUST_AI_I18N_DOCGEN_REAL_MODEL=1` asks: then "quick setup RUNS" also
  applies the setup (an engine install and a model download start, and are cancelled).

## Prereqs

```bash
npm install                          # in e2e/ (playwright-core), at the app root, and once in src-electron/ (electron)
npm run build:unpacked               # from the app root — the harness drives the BUILT desktop app
```

No browser download and no driver binary: Playwright attaches to the Electron the app ships. The packaged build's
fuses forbid this driver (`enableNodeCliInspectArguments: false`) — the same in every family app.

## Scripts (run from the APP ROOT)

- `npm test` — the contract scan and the smoke suite: BEHAVIOUR assertions (the AI-tasks toggle stays open, the
  wizard opens with the translation catalog, Home shows staged work, a path that isn't there is said under the
  path box, Review's keyboard moves the selection). Stop your dev server first.
- `npm run screenshots` — every surface as PNGs into `e2e/shots/` (gitignored), on the same hermetic world.

**Cadence** (user ruling 2026-10-28): the change's own test while building; this suite once, when the work is done.

## Your real project — the acceptance walk

The suite never touches your real project. Before a change ships, the real app is walked on your real data and
**THE real project, JustWrite** (source `justwrite-app/src/i18n/locales/en.json`, config
`justwrite-app/just-ai-i18n-docgen/config.json`): `npm run dev`, or the server alone with the project loaded —

```bash
npm run server -- --config E:\Dev\Web\justwrite-app\just-ai-i18n-docgen\config.json
```

`npm run server` reads the same dev data folder the desktop app does (`data/` in this checkout). When a report
comes in, verify against the data folder the app actually used — `data/` for `npm run dev`, the folder beside the
installed exe (or the one Settings → Storage names) for the installed app — and read `<data>/logs/*.log` plus
`<data>/ai-cache/llamacpp/logs/`.

## Gotchas

- The harness drives whatever `dist/electron/UnPackaged` was last built — rebuild after renderer or shell changes.
- The unpacked build can't start a server of its own (Quasar's `--skip-pkg` skips installing its dependencies),
  which is why the harness starts one.
