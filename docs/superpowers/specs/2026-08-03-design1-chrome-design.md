# Design 1 + the standard app chrome — design spec

**Ruled 2026-08-03.** Design 1 (sidebar + language table) is THE layout, picked in the
real WebView2 via the e2e harness after a three-way live comparison. This spec is the
approved integration of the standard family chrome into that shell. Context: the first
build shipped the translate→review workflow with NONE of the chrome (no AI surface, no
settings, no logs, no storage UI) — called out by the user 2026-08-02; the fix is this
spec plus a "standard app chrome" section in the family doc so omission cannot recur.

## Navigation (final)

Sidebar (design 1, labeled), two groups + footer:

- **Home** — the ruled table dashboard: language-per-row, checkbox multi-select,
  Translate (scope=pending), row click → Review. JobStrip (translate jobs) lives here.
- **Review / Runs / Docs** — as built.
- *divider*
- **AI** (`/ai`) — the kit's `AiModelsArea`, whole page: providers CRUD, model catalog
  + downloads (progress, cancel), engine presets, usage ledger (tokens). No app tab.
- **Settings** (`/settings/:section?`) — JW's section pattern:
  - **appearance** — JV-style panel over kit catalogs: mode, UI font, accent presets,
    UI scale. Replaces the lone theme-cycle button (which stays as a shortcut).
  - **storage** — data root shown + relocate via the shell's existing
    `storage_get_root`/`storage_relocate` commands (desktop only; headless shows the
    path from the server env). Disk usage via the shared `make_disk_router`.
  - **logs** — kit `LogsPanel` over the shared `make_logs_router`.
  - **about** — version, headless URL, repo.
  - **Reviewer** field moves here (tool-level state, appmeta) — Setup links to it.
- **Setup** — project-scoped only (path/check, targets, context, glossary, gitignore).

Footer: theme-cycle button + **`AiStatusButton`** (kit) — the global AI task
progress/cancel surface (JW mounts it in its TitleBar; this shell's footer is the
equivalent slot).

## Server

JW's exact platform wiring (shared `llm_runner.platform`):
`install_log_ring()` + `install_file_log(data_dir/"logs"/"just-ai-i18n-docgen.log")`
before app construction; mount `make_logs_router("Just AI i18n & Docgen")` and
`make_disk_router(...)`. Tests must FETCH `/v1/logs/all` (a ring with content) and the
disk route — mounting is not proof.

## Deferred, recorded

`make_data_router` (backup/restore/reset) and `UpdatesPanel` — next block, in HANDOFF.
Client vitest unit tests — separate standing gap. Prompts tab relevance: this app keeps
`feature_prompts={}` (prompts are built in-code, shielding is a substitution) — if
`AiModelsArea`'s prompts tab confuses here, hide it via its props; note what was done.

## Testing

- Server: logs + disk route tests (content, not just 200).
- e2e smoke additions: `/ai` mounts the models area; `/settings` renders sections;
  logs panel fetches; capture list grows `ai.png`, `settings-*.png`.
- Every screen verified via `npm run screenshots` (real WebView2) before "done".

## Standard doc

New "standard app chrome" section in `app-structure.md`: AI area, AiStatusButton,
settings sections (appearance/storage/logs/about), platform log+disk wiring — each with
its canonical file, plus definition-of-done boxes.
