# just_ai_i18n_docgen

Translate standard i18n JSON locale folders with a local or online AI engine, verify
every string that was written, and author help docs whose front-matter becomes locale
keys — with a human review workspace where nothing ships unseen. The Python rewrite
of the retired Node `just-ai-help`, embedding the family's shared LLM stack
(`../just-llm-runner`) for everything engine-shaped.

Desktop app: Vue 3 + Tauri 2 shell over a FastAPI server on port **8742**. A job
writes only proposals — the locale file is byte-identical until a human applies; the
engine never signs off (`<lang>.accepted.json` is the human record).

## Run it

```bash
npm install
npm run dev            # THE APP — desktop window; spawns the Python server itself
npm run dev:vite       # browser-only dev at :1450 (start the server yourself: npm run server)
npm run server         # the Python server on :8742 (venv-resolved via scripts/py.js)
```

First time: create the server venv (`cd server && python -m venv .venv`) and install
it editable (`.venv/Scripts/pip install -e .[dev]`).

## Verify it

```bash
npm run test:server    # pytest
npm run lint           # biome over src/
npm test               # e2e smoke: the REAL app via tauri-driver (build release first)
npm run screenshots    # every surface from the real WebView2 → e2e/shots/
```

The real webview is the acceptance surface — see `e2e/README.md`, including its one
law: never drive :8742 while your own dev window is open on it.

## Where to look

- `CLAUDE.md` — the working rules, the "what bites" list, and all pointers.
- `docs/dev/TASKS.md` — the live open-work tracker; `docs/dev/IDEAS.md` — the backlog.
- `../just-llm-runner/docs/app-structure.md` — the family structure standard this
  app is the reference implementation of.
- `server/just_ai_i18n_docgen/api/workspace_api.py` — the review workspace API routes (the Workspace class + write rules: `server/just_ai_i18n_docgen/workspace.py`).

There is also a CLI door over the same service functions:
`server/.venv/Scripts/just-ai-i18n-docgen translate|check|escalate|accept|extract <config>`.
