# just_ai_i18n_docgen — E2E test & screenshot harness

WebDriver-driven automation for the real Tauri build — **JustWrite's harness,
same shape, same run model** (see `justwrite-app/e2e/`). Drives WebView2 on
Windows via [tauri-driver](https://github.com/tauri-apps/tauri/tree/dev/tooling/webdriver)
+ msedgedriver, talking direct WebDriver HTTP from Node — no WebdriverIO
(JW tried v8 and v9; both failed the session handshake — direct HTTP won).
The wrapper lives in `lib/driver.js`.

## Prereqs

```bash
cargo install --locked tauri-driver
npm install            # fetches msedgedriver via postinstall (Edge-version matched)
npm run tauri build -- --no-bundle    # or: npm run build — the harness drives target/release/
```

## Run what the USER runs

The server these scripts talk to must be **the app's own** — same data dir, same
project, same state you see in the window. `npm run server` starts it on the app's
default data dir; `npm run dev` has the shell spawn it for you.

Pointing the harness at a throwaway config + data dir (as this repo did on
2026-08-03) means the two of you are looking at different apps: the user hit a
first-run engine failure that no green suite here could have seen, and their
launch EVICTED the scratchpad server mid-session. When a report comes in, verify
against the data dir the app actually used —
`src-tauri/target/debug/data` for `npm run dev`, `…/release/data` for the built
exe — and read `<data>/logs/*.log` plus `<data>/ai-cache/llamacpp/logs/`.

## Scripts (run from the APP ROOT)

- `npm test` — the smoke suite: real app, real WebView2, BEHAVIOUR
  assertions (the AI-tasks toggle stays open, the wizard opens a real
  dialog with the translation catalog, Home shows staged work). **Needs a
  server on :8742** (`npm run server`, or the demo config) — the suite
  reads live endpoints. `JAID_DEV_NO_SIDECAR=1` means it never spawns or
  evicts servers.
  **One test writes**: "quick setup RUNS" drives the real wizard, so it
  writes the engine presets (that write IS the assertion — a wizard that
  corrupts routing must fail here) and then restores them, verifying the
  restore. It also starts a real load and cancels it; on a box with the
  engine installed and the model absent, expect a few seconds of download
  before the cancel.
- `npm run screenshots` — captures every surface as PNGs into `e2e/shots/`
  (gitignored). Start the demo server on :8742 first if you want shots
  with data; `CAPTURE_NO_SIDECAR=0` exercises the real sidecar spawn
  instead.

## Deviation from JW, recorded

JW's `e2e/package.json` still carries vestigial WebdriverIO devDependencies
from the failed attempt its own README describes; this harness starts clean
(zero deps — node builtins + global fetch). Sync JW down to match at the next
touch, not up.

## Gotchas (JW's, still true)

- The release binary is whatever was last built — rebuild after source drift.
- `tauri-driver` is brittle if :4444 is already bound; orphans need
  `taskkill /F /IM tauri-driver.exe`.
- After the results print, the drivers may LINGER and hold the console —
  the results above are final; taskkill tauri-driver + msedgedriver.
- Don't run capture while your own dev window is open on the same server.
