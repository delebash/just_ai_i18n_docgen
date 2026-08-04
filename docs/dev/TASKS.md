# TASKS — the live open-work tracker (just_ai_i18n_docgen)

> **THIS is the live tracker** — same charter as JW's `docs/dev/TASKS.md`. One line per
> item + a pointer to its detail doc; the depth lives in the linked doc, not here.
> **Close = delete** — git and the plan docs keep history. Add an item the moment it's
> real. A tracker line is a claim, not evidence.

## Awaiting your QC (built 2026-08-04, gates green, committed same day)

- **The shared boot surface** — kit `<BootModelLoad />` (model bar titled with the MODEL
  NAME — your ruling) + kit `startWarmOnBoot()`; this app: single splash (static plate in
  `index.html`, pre-mount warm start, no spinner, no shell flash); JW adopted the same
  control (its splash shows the model name now). Evidence:
  `docs/plans/archive/2026-08-04-kit-reuse-audit.md`. Gates: docgen biome+vite ✓, JW 560/560
  vitest + build + i18n report ✓ (its two report rows pre-exist today, proven on a
  stashed clean tree).
- **Kit-first swaps in this app** — 5 fact tables → kit `.ui-formgrid`, 2 textareas →
  `UiTextarea`, flag chips → `UiTag`, 2 empty states → `EmptyState`, both progress bars →
  `UiProgress` (kit export + `bare` prop added); dead `.langtable`/`.bar`/`.plain` CSS and
  the unreferenced 1.81 MB splash PNG deleted. `.iconbtn` KEPT — JW's TitleBar hand-rolls
  the same; it conforms.
- **⛔ The one gate not yet run: `npm test` + `npm run screenshots`** — the harness's own
  rule forbids driving :8742 while your dev window is open on it (e2e/README). Close the
  app, say the word, and the real-webview pass runs (note: the smoke's wizard test writes
  presets + starts/cancels a real load, by design).

## Open — needs your go

- **DOCS PHASE 2 — CODE-FIRST COVERAGE (the user's correction 2026-08-04: "checking
  code, deep audit of code, comparing against docs — all coded features in
  appropriate user or dev docs, plus the design-whys").** Phase 1 verified claims
  docs already made; it never enumerated the BUILT surface and asked "where is this
  explained?". In flight: three read-only audits (JW · JV · this app) enumerating
  features FROM CODE and rating user-doc / dev-doc / design-why coverage. Then, on
  the go: write the missing user docs (real explanations, JW/JV extend their
  corpora; THIS APP gets its first user docs — it has none), the dev getting-started
  indexes with links to the design-decision docs, and fix any doc claiming features
  code lacks.

- **Product questions from the code-first audit (2026-08-04) — your rulings:**
  (a) **App-run jobs skip the confirmation pass** — only CLI `translate` pre-ticks
  rows, though the design intent says pre-ticks are the normal flow; build it into
  app runs, or bless CLI-only? (b) The **probe** is CLI-only, so `unsure` scope
  finds nothing for app-only users (docs say so honestly). (c) **Escalation from
  the UI is latent** — the server accepts `presetId` on `POST /v1/jobs`; no view
  sends one. (d) `conventions.json` ships **Spanish only** — other languages get no
  paired-punctuation checks. (e) `POST /v1/undo` with no `lang` pops across ALL
  languages, and the Review page sends none. (f) Six routes have no caller in this
  app (`/v1/terms`, `/history`, `/accepted`, `/reference`, `/gt-frame` — which
  ships a third-party Google script with no visible entry — and `/ai/prompt-preview`
  is kit-consumed). (g) About hardcodes `0.1.0` beside pyproject's version.
  (h) `glossary` shape drifts (bare array vs `{doNotTranslate}`).
- **Help is wired minimal (2026-08-04): drawer + "?" on Settings and AI only** —
  the other five views still hand-roll `.page-head` (the open PaneHeader contract
  item), so they carry no trigger yet; no full-pane reader route. Real-webview
  render of the drawer is UNVERIFIED (window-gated with the e2e pass).
- **Backups/restore/reset + updates surface — deferred by the chrome spec, never
  tracked until now (docs campaign 2026-08-04, code-verified absent):** the shared
  `make_data_router` is not mounted by this server and neither kit `DataManagement`
  nor `UpdatesPanel` is imported anywhere in `src/` (zero grep hits). The chrome spec
  (`docs/superpowers/specs/2026-08-03-design1-chrome-design.md` §Deferred) parked
  them "next block"; JW has both surfaces. Needs a go.
- **Family headless/tray spec (your ruling 2026-08-04, all three apps):** every app's exe
  opens the GUI and owns a TRAY icon (Show app · Exit); Settings gains "keep server
  running after the app closes" (headless mode) — off ⇒ closing the app stops the server;
  on ⇒ the tray app stays for server stop/start while the GUI hides. "This was supposed
  to be the way JW and all apps work." Needs: plan across JV/JW/i18n + a section in
  `app-structure.md`.
- **Appearance doesn't work in this app (your QC).** Diagnose, and per your ruling the
  appearance surface should be SHARED for JV + i18n (JW stays its richer own).
- **CONTRACT BUILD — first pass LANDED 2026-08-04 (uncommitted), remainder below.**
  DONE + gated (docgen lint/build/contract ✓ · JW 563/563 + build ✓): the kit
  `familyContract.js` manifest; DownloadBar/ConnectionError/AI-tab/dialog-verb strings
  read FROM it; docgen nav trio → contract words (by construction); ConnectionError →
  JW's mount-instead pattern + devHint; kit `PaneHeader` (lifted from JW, JW's 20 views
  swapped to it, local copy deleted); kit `SettingsShell` (JW's top-tabs, docgen's rail
  DEAD); docgen settings sections + storage words → contract (Server logs · Free disk
  space · Clear… · Total); **contract gates live and PROVEN TO BITE** (docgen
  `npm run contract` node:test scan — injected violations went red; JW vitest twin).
  REMAINING from the go, in order: kit QuickSetup surgery (copy seam + family
  cache-offer step + capabilities gate + `onApplied`) → delete the 359-line fork +
  wizard word canon (Apply setup · The engine) · once-ever AI offer lifted from JW's
  AiSetupDialog (replaces Home's permanent button) · TitleBar frame lift · usePoll
  export + docgen's two hand-rolled polls · JW adopts SettingsShell + gains the Server
  section + Total row · standard §11 points at the contract · the raw hue-slider vs
  UiColorPicker check · the window-gated release e2e + screenshots.
- **THE CONSISTENCY SWEEP IS DONE — 48 divergences enumerated, classified, evidence at
  file:line: `docs/plans/2026-08-04-consistency-sweep.md`.** 9 already fixed same-day;
  ~35 open across nav labels · page headers/Help (zero Help affordances app-wide) ·
  settings chrome+wording · wizard copy · ConnectionError shape · 7 kit gaps (no
  PaneHeader/TitleBar/SettingsShell components; QuickSetup/DownloadBar/ConnectionError/
  tab strings hardcoded; usePoll unexported; dialog-verb door unused by BOTH apps).
  Plus the structural finding: **this app has no i18n layer at all** — every string a
  literal; your call whether it adopts JW's pattern now or after the single-source
  system. The sweep is the contract's first enforcement list.
- **THE FAMILY SURFACE CONTRACT — the systemic fix for drift (proposed 2026-08-04,
  awaiting your go).** Root cause of every find so far: surfaces authored fresh with no
  machine-checkable canon and no gate. Three tiers: (1) a machine-readable manifest in
  the kit (`familyContract.js`) naming canonical labels + shapes (nav trio wording ·
  Settings = top tabs · dialog verbs · band/CTA copy), which kit components read their
  OWN defaults from so canon and kit can't disagree; (2) a contract TEST each app's
  suite runs (the `useCatalogMeta.contract.test` precedent) asserting the shared subset
  renders canon words + banning the known hand-roll patterns (raw tables, local
  progressbars, rail-settings chrome) — drift fails CI, not your eyes; (3) app voice
  through ONE door (the sanctioned copy objects), so a template can't quietly restate a
  kit concept. The full inconsistency sweep (agent, in flight) becomes tier-2's first
  fix list. `app-structure.md` §11 points at the manifest instead of prose.
- *(Menu + name consistency: CLOSED by the contract build — the nav trio words and
  the top-tab SettingsShell shipped; the last wording bits (wizard copy canon) ride
  the QuickSetup chunk above.)*
- ~~Routing by feature~~ **BUILT 2026-08-04, awaiting your QC** (and one earlier claim of
  mine corrected: review was NEVER on fallback — `app.py` deliberately seeds
  `review → p_translate`, "back-translation: same engine the translation used"). What
  shipped: the kit's promptless Lab — selecting a feature now shows the REAL generated
  prompt (read-only, unlockable test copies, banner: never saved) above the SAME preset
  surface JW has (model · temp · samplers · Save as preset · Use in production); this
  app's `/v1/ai/prompt-preview` builds translate + confirm previews with the production
  builders (shielding included), loud named 400s when nothing to sample; extract removed
  from the routing catalog (engineless — the CLI door untouched); the false
  "edit presets under a provider's row" hint deleted. Gates: 135/135 pytest (+6 preview
  tests, the features test moved 4→3 with the reason), biome, vite build, JW 560/560 +
  build. Real-webview pass still owed (window-closed gate below).
- *(Moved 2026-08-04, the tracker-placement rule — an item lives where the code that
  closes it lives: the engine-cache `replaceBuild` guard, the silent update-check,
  the embeddings-note capability gate, and the class-tune seed noise are now lines in
  `../just-llm-runner/docs/dev/TASKS.md`. The docs-convention item CLOSED — it is
  `app-structure.md` §13 now, and runner + JV both have their tracker pair.)*
- **Commits — everything through the docs campaign is COMMITTED, NOTHING is
  pushed** (pushing needs your word). The day's arc: contract build (runner
  `cf598b9` · this app `d43ef36` · JW `27f7c68`) → labels build (runner `1a9f8cc` ·
  JW `baf013e`) → the docs campaign + distillation (per-repo commits, see
  `git log`).
