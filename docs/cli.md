# The command line

The same brain as the app, no window. Installed in the server venv:

```bash
server/.venv/Scripts/just-ai-i18n-docgen <command> <config> [options]
```

`<config>` is the path to your project's `just-ai-i18n-docgen/config.json` — every path
in a run resolves against that file, never against where you ran the command.

## Commands

- **`translate <config>`** — a full run: translate what's pending, verify, stage
  or write per your review state, run the probe sample and the confirmation pass.
  - `--force` — retranslate everything, ignoring the cache.
  - `--probe` — the self-agreement pass (see
    [verification](verification.md)); needs non-zero temperature.
  - `--no-confirm` — skip the confirmation pass.
- **`check <config>`** — offline checks only; deterministic; **exit 1 on
  failures** (advisory `disagreement` never fails it). The CI gate.
- **`escalate <config> <preset-id>`** — re-translate only flagged keys with a
  stronger preset.
- **`accept <config> key1,key2 --by "Your Name"`** — record acceptances from the
  terminal; `JUST_AI_I18N_DOCGEN_REVIEWER` supplies the name when `--by` is omitted.
- **`extract <config> [--check]`** — docs front-matter → locale keys
  ([details](docs-authoring.md)). Makes no engine call.

Global: `--data-dir` points the tool at a different app-data folder.

The server itself: `just-ai-i18n-docgen-server serve --host --port --data-dir
--config` — the headless door; open the served UI in a browser.

## One implementation, two doors

The CLI and the app share every decision — the same checks, the same staging
rules, the same acceptance records. A CLI run shows up in the app's Review page
exactly like an app run. (One caveat while both are open at once: writes are
atomic but not locked — finish one door's action before using the other.)
