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

## Scripts (run from the APP ROOT)

- `npm test` — the smoke suite: real app, real WebView2. Asserts the shell +
  nav mount, the design pill flips shells, Setup shows the WHOLE form with an
  explicit **Check path** button (the 2026-08-02 rulings as assertions), and
  Home degrades to the honest empty state. Runs with `JAID_DEV_NO_SIDECAR=1`
  so it never evicts or spawns servers — hermetic, mutates nothing.
- `npm run screenshots` — captures every surface (and Home once per design
  candidate) as PNGs into `e2e/shots/` (gitignored). Start the demo server on
  :8742 first if you want shots with data; `CAPTURE_NO_SIDECAR=0` exercises
  the real sidecar spawn instead.

## Deviation from JW, recorded

JW's `e2e/package.json` still carries vestigial WebdriverIO devDependencies
from the failed attempt its own README describes; this harness starts clean
(zero deps — node builtins + global fetch). Sync JW down to match at the next
touch, not up.

## Gotchas (JW's, still true)

- The release binary is whatever was last built — rebuild after source drift.
- `tauri-driver` is brittle if :4444 is already bound; orphans need
  `taskkill /F /IM tauri-driver.exe`.
- Don't run capture while your own dev window is open on the same server.
