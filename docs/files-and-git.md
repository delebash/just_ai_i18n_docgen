# Your files, and what to commit

Everything the tool keeps about your project lives in ONE folder inside your
app's repo: `just-ai-help/`, beside your `package.json`. Every path resolves
against `config.json` in that folder — run the CLI from anywhere.

## Commit these (they are your project's record)

- **`config.json`** — the project: `source` (the one path fact — its folder is
  your locale dir, its basename your source language), `targets`, `context`,
  `glossary`, placeholder/plural settings (inferred when absent), and the docs
  prefixes.
- **`<lang>.accepted.json`** — the human review record: who accepted what,
  hashed over (key, flag, source, target) so edits re-open findings. Committed so
  CI's `check` sees the same acceptances you do.
- **`<lang>.notes.json`** — your notes to the translator, per key.

## Gitignore these (machine state — the Setup page prints the block to paste)

- `<lang>.probe.json` — the probe's second-pass sample.
- `.jah-cache.json` / `.jah-probe-cache.json` — translation caches.
- `.jah-state.json` — your review cursor, the undo log, staged proposals, the
  back-translation cache, run history. **Deleting it costs your place and your
  undo history — never your work**: applied translations are in your locale
  files, acceptances and notes in their committed files.

## One folder, both doors

The app and the CLI read and write the same files. Writes are atomic but not
locked — if a CLI run and an open Review page race, last write wins; finish one
before driving the other.
