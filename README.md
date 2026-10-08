# just_ai_i18n_docgen

Translate standard i18n JSON locale folders with a local or online AI engine, verify
every string that was written, and author help docs whose front-matter becomes locale
keys — with a human review workspace where nothing ships unseen. It embeds the family's
shared LLM stack (`../just-llm-runner`) for everything engine-shaped.

Desktop app: Vue 3 in an Electron shell over a Node (Fastify) server on port **8742** — the
first family app to move off Tauri and Python (2026-10-08; the plan is JustVoice's
`docs/plans/2026-10-07-electron-node-plan.md`). A job writes only proposals — the locale
file is byte-identical until a human applies; the engine never signs off
(`<lang>.accepted.json` is the human record).

## Run it

```bash
npm install            # needs the kit checked out beside this repo: ../just-llm-runner
npm run dev            # THE APP — Vite on :1450 and the desktop window; the window starts the server itself
npm run dev:vite       # browser-only dev at :1450 (start the server yourself: npm run server)
npm run server         # the server alone on :8742, the same UI at http://127.0.0.1:8742/
npm run cli -- translate <config>   # the CLI: translate | check | escalate | accept | extract
```

In development the data folder is `data/` in this checkout (the database, logs, the engine
cache). Nothing needs installing beyond `npm install` — no Python, no Rust.

## Verify it

```bash
npm run test:server    # the server's tests (vitest, on Electron's own Node)
npm run test:unit      # the renderer's unit tests
npm run lint           # biome
npm run build:vite     # then:
npm test               # e2e smoke: the REAL desktop app, driven by Playwright's Electron driver
npm run screenshots    # every surface from the real window → e2e/shots/
```

The real desktop app is the acceptance surface — see `e2e/README.md`, including its one
law: never drive :8742 while your own dev window is open on it.

## Build the installer

```bash
npm run build          # vite build + electron-builder → release/
```

The installed app carries two command-line launchers beside its exe:
`just-ai-i18n-docgen-server serve [--host] [--port] [--data-dir]` (the server and its UI,
no window) and `just-ai-i18n-docgen <command> <config>` (the CLI). Both run the app's own exe
as Node, so they need nothing else installed.

## Where to look

- `CLAUDE.md` — the working rules, the "what bites" list, and all pointers.
- `docs/dev/TASKS.md` — the live open-work tracker; `docs/dev/IDEAS.md` — the backlog.
- `../just-llm-runner/docs/app-structure.md` — the family structure standard.
- `server/src/api/workspace_api.js` — the review workspace API routes (the Workspace class +
  write rules: `server/src/workspace.js`).
- `electron/main.js` — the desktop shell's settings (the shell itself is the kit's
  `@delebash/llm-runner/shell`).
