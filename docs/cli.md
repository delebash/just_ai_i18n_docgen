# The command line

The same brain as the app, no window. The installed app carries it beside its exe on
Windows, beside the executable on Linux (an AppImage: run it with `--appimage-extract`
first, the launcher is in `squashfs-root/`), and in the app's `Contents/Resources` on
macOS; it trusts your system's certificates, so it works behind a network that inspects
TLS. From a source checkout, run it through npm:

```bash
just-ai-i18n-docgen <command> <config> [options]          # an installed app
npm run cli -- <command> <config> [options]                # a source checkout
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

Global: `--data-dir` points the tool at a different data folder. By default
that folder sits inside the install directory (`data`), not in a per-user
app-data location — see [Getting started](getting-started.md).

The server itself: `just-ai-i18n-docgen-server serve --host --port --data-dir --config`
(`npm run server` from a source checkout) — the headless door; open the served UI in a
browser. On Windows it sits beside the app's exe; on Linux beside the executable (an
AppImage: run it with `--appimage-extract` first, the launcher is in `squashfs-root/`); on
macOS in the app's `Contents/Resources`.

## One implementation, two doors

The CLI and the app share every decision — the same checks, the same staging
rules, the same acceptance records. A CLI run shows up in the app's Review page
exactly like an app run. (One caveat while both are open at once: writes are
atomic but not locked — finish one door's action before using the other.)
