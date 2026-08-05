# TASKS — the live open-work tracker (just_ai_i18n_docgen)

> **THIS is the live tracker** — same charter as JW's `docs/dev/TASKS.md`. An item
> carries the APPROVED DECISION TEXT: what was shown to the user and approved, pasted
> at approval time, complete enough to code from without re-deriving what was decided
> (the rule: `~/.claude/rules.md`). Deeper decided detail may live in a detail doc the
> item points to — **read that doc before coding the item**. Close = delete — git
> keeps history. A tracker line is a claim, not evidence — verify against code.

## Awaiting your QC (built 2026-08-04, gates green, committed same day)

- **The shared boot surface** — kit `<BootModelLoad />` (model bar titled with the MODEL
  NAME — your ruling) + kit `startWarmOnBoot()`; this app: single splash (static plate in
  `index.html`, pre-mount warm start, no spinner, no shell flash); JW adopted the same
  control (its splash shows the model name now). Evidence:
  `docs/plans/archive/2026-08-04-kit-reuse-audit.md`.
- **Kit-first swaps in this app** — 5 fact tables → kit `.ui-formgrid`, 2 textareas →
  `UiTextarea`, flag chips → `UiTag`, 2 empty states → `EmptyState`, both progress bars →
  `UiProgress` (kit export + `bare` prop added); dead `.langtable`/`.bar`/`.plain` CSS and
  the unreferenced 1.81 MB splash PNG deleted. `.iconbtn` KEPT — JW's TitleBar hand-rolls
  the same; it conforms.
- **Real-webview gate GREEN 2026-08-04** — first round smoke 18/18 + all 10 surface
  shots against the real project (JW config, real data dir, warm setting restored).
  That round found and fixed: the missing `/v1/health` boot-gate route, the kit's
  unimported `watch` (the promptless Workbench had NEVER mounted — here or JW), two
  stale smoke selectors (`.set-tab`, `Clear…`). Second round (same day, the audit's
  fix batch): **18/18 again, and the routing test exercised the LAB branch live** —
  preview 200 on the finished real project ("every key translated — sampling 6 done
  key(s) · es"), Generated prompt + banner + Save as preset + the unlock all
  asserted. Shots in `e2e/shots/`.
- **Routing by feature + the promptless Lab** — the full decided shape is BUILT:
  same preset surface as JW (model · temp · samplers · Save as preset · Use in
  production), the REAL generated prompt read-only with "Edit copies for this test"
  unlock → ephemeral never-saved copies, "Restore generated", the sample line naming
  its source + built-time, finished-project sampling (see the shipped-decisions note
  at the bottom). The Lab's test-RUN loop (Run in a column → Use in production)
  needs a loaded model — that part is yours to QC live.

## Open — needs your go (each item = the approved decision, in full)

- **e2e: a Setup create-flow fixture test** (your call 2026-08-04: first-run setup
  belongs in the test surface). Decision: fixture-based — the test creates its own
  scratch `en.json` inside the harness, walks the real Setup form's Check path →
  Save → asserts the server answers `loaded: true`, then cleans up its fixture;
  it never touches the real repos. Today's smoke only asserts the Setup form
  renders.

- **Cold-boot warm kickoff exceeds the design intent** — `main.js` awaits
  "decision + kickoff" only, yet on a cold data dir (first router spawn + CUDA
  init) the awaited kickoff evidently ran past 14.5 s (found 2026-08-04). Decision:
  measure what the await actually costs cold, then decide (with evidence, in chat)
  whether kickoff should return earlier — kit/server change, a real boot-latency
  item for first launches.

- **App-run jobs must gain the confirmation pass — a GAP, not a question** (the
  audit's correction 2026-08-04: root CLAUDE.md records "the confirmation pass
  PRE-TICKS rows in workshop state" as THE design, unconditional). Today only CLI
  `translate` runs the pass; a job started from the app leaves every row un-ticked.
  Decision: app-run jobs run the same confirmation pass and pre-tick the same way.
  Its build is its own go (it touches the job pipeline).

- **Product questions from the code-first audit (2026-08-04) — your rulings:**
  (b) The **probe** is CLI-only, so `unsure` scope finds nothing for app-only users
  (docs say so honestly). (c) **Escalation from the UI is latent** — the server
  accepts `presetId` on `POST /v1/jobs`; no view sends one. (d) `conventions.json`
  ships **Spanish only** — other languages get no paired-punctuation checks.
  (e) `POST /v1/undo` with no `lang` pops across ALL languages, and the Review page
  sends none. (f) Six routes have no caller in this app (`/v1/terms`, `/history`,
  `/accepted`, `/reference`, `/gt-frame` — which ships a third-party Google script
  with no visible entry — and `/ai/prompt-preview` is kit-consumed). (g) About
  hardcodes `0.1.0` beside pyproject's version. (h) `glossary` shape drifts (bare
  array vs `{doNotTranslate}`).

- **Test-mode links to the prompt's real data — needs one design decision first**
  (agreed in the Lab design, A917: "test mode links straight to those" — the
  context sentence, glossary, per-key notes — "so 'I want the prompt to say X' has
  a real home"; built today only as tooltip words). Open question before coding:
  the kit can't know app routes, so the door is either a kit seam (the app passes
  link targets into the Workbench) or an app-side hint line. Decide in chat, then
  build.

- **Help is wired minimal (2026-08-04): drawer + "?" on Settings and AI only** —
  the other five views still hand-roll `.page-head` (the open PaneHeader contract
  item), so they carry no trigger yet. The page→doc mapping is already fixed for
  the moment they adopt PaneHeader: Home → `translate.md`, Review → `review.md`,
  Runs → `translate.md`, Docs → `docs-authoring.md`, Setup → `project-setup.md`.
  No full-pane reader route. The drawer's real-webview render: asserted indirectly
  (page mounts), not yet eyeballed — rides your QC.

- **Backups / restore / reset + updates surface** (decided 2026-08-04, A1190; both
  deferred by the chrome spec and never built here). The decision in full: the kit
  surface already exists (`DataManagement`: backup zip · restore · reset) and JW
  mounts it, but the `/v1/data/*` routes live in JW's server only — so **upstream
  the data router into the shared stack** (`install_llm`), carrying JW's recorded
  lesson (a reset must properly RE-SEED — one once silently lost the app's extra
  catalog rows and tunes), then this app mounts kit `DataManagement` under
  Settings → Storage. Backup scope here is honest-small: the DB holds machine
  state only (providers, keys, presets, tunes, usage); the project's real truth
  (`config.json`, accepted, notes) is committed per-project in YOUR repo. Kit
  `UpdatesPanel` is part of the same adoption. "Apps are consistent but only use
  what they need" holds because the need itself is shared.

- **Family headless/tray spec (your ruling 2026-08-04, all three apps).** The
  decision in full: every app's exe opens the GUI and owns a TRAY icon; Settings
  gains "keep server running after the app closes" — OFF ⇒ closing the window
  stops everything; ON ⇒ the window closes but the tray + server stay (your
  correction: the tray REMAINS, the window closes). **JV already ships this and is
  the DONOR** — tray with Show/Hide · Start/Stop/Restart server · Quit,
  `keep_running_on_close` in its `lib.rs`, the setting at Settings → Lifecycle,
  user docs in its `system-tray.md`/`run-modes.md`. Remaining work = lift the
  pattern to JW + this app + a section in `app-structure.md`.

- **Appearance doesn't work in this app (your QC).** Decision: diagnose it, and
  per your ruling the appearance surface becomes SHARED for JV + this app; JW
  keeps its richer own.

- **CONTRACT BUILD — remainder under the standing go.** What's DONE + gated is in
  git (manifest, contract-fed strings, ConnectionError mount-instead, PaneHeader +
  SettingsShell lifts, contract gates proven to bite, labels store with in-place
  invariant + JW boot/locale feed). The remainder, each the approved decision:
  1. **QuickSetup surgery** — the kit wizard gains a copy seam (`quickSetupCopy`,
     the `catalogCopy` pattern) + the family **cache-offer step** (its server half
     is already in the shared stack; only the step's UI is stranded in this app's
     fork, port from `QuickSetupI18n.vue:86-139, 279-295`) + a capabilities gate on
     the embeddings flow (also fixes the embeddings note at `AiModelsArea.vue:573`)
     + an `onApplied` hook; then this app's 359-line `QuickSetupI18n.vue` fork IS
     DELETED — its only app-specific behavior (pointing translate/confirm presets
     at the chosen model) becomes a few-line hook via the config service. Canon
     words apply: **"Apply setup"** · **"The engine"** (already in the manifest).
     Then re-check the e2e wizard tests (smoke runs the REAL wizard — its routing
     write + restore and the modal title copy). **MUST READ first:**
     `docs/plans/2026-08-04-consistency-sweep.md` §"Resumption notes".
  2. **The configured-state truth** (decided 2026-08-04, A1190 — this item was
     LOST from the tracker and restored by the audit): when a default provider
     already exists, the AI band stops pitching like a first run and reads
     "**Local AI is set up — <model> is the default · Re-run setup**", and the
     wizard opens on an "**already set up**" screen offering only *change model*
     or *close*. The manual "Run Quick Setup" door stays — it just tells the truth
     about the state. (Kit change; both apps get it.)
  3. **The once-ever AI offer** (ruling R3): every app uses JW's one-time modal —
     lift JW's `AiSetupDialog` into the kit with manifest copy; this app drops the
     permanent Home "Set up local AI" button and persists the once-flag; the
     standard stops permitting two shapes.
  4. **TitleBar frame lift** — kit component lifted from JW's donor (never
     authored fresh), this app swaps on.
  5. **usePoll export** — kit exports it; this app's two hand-rolled
     `setInterval` polls (`HomeView.vue:36-38`, `stores/jobs.js:126-129`) swap on.
  6. **JW adopts SettingsShell + gains the "Server" section (ruling R1) and the
     "Total" disk row (ruling R2)** — its own gated step with its suite + your QC.
  7. **`app-structure.md` §11 points at the contract manifest** instead of
     restating words; the raw hue-slider vs `UiColorPicker` check rides along.

- **THE CONSISTENCY SWEEP — the enforcement list**: 48 divergences enumerated with
  file:line evidence in `docs/plans/2026-08-04-consistency-sweep.md`; 9 fixed
  same-day, ~35 remain (they cluster in the items above). **Read it before any
  contract-build chunk.** Structural finding recorded there: this app has NO i18n
  layer (every string a literal) — ruled LATER (R4), after the single-source
  system.

- **The single-source text system — NEXT BIG TASK, own go, docs-first order
  (ruled).** The decision in full: one authored docs page per surface is the
  single source for (1) the Help page, (2) the in-app short texts — front-matter
  `lede:`/`hints:` extracted by this app's `extract` into locale keys the app
  renders, `extract --check` failing CI on drift — and (3) translations, since
  those keys ride the normal translate → verify → review → accept pipeline. Key
  facts binding the build: JW already RENDERS hint keys
  (`characters.fields.<group>.<key>.hint`) so its half is "make extract write what
  JW reads"; but extract's contract writes `hints.<page>.<field>` — **a structural
  key-shape mismatch that is THE first design question, answered in chat before
  any build**; this app can't dogfood renderside until its own i18n layer (R4:
  later); front-matter authoring is order-independent (today's corpus pages get
  front-matter during the build). Detail doc (MUST READ):
  `justwrite-app/docs/plans/2026-07-26-i18n-single-source-research.md` — its seven
  decisions get re-verified against code first.

*(Shipped-decisions note, 2026-08-04 late batch — for QC context, close-by-delete
when QC'd: the finished-project preview sampling (translate samples done keys +
says so; confirm falls back identical → translated → any source key; busiest-
language default; explicit keys stay loud) · "Restore generated" + the built-time
stamp on the sample line (absolute clock time on purpose — a relative "2 min ago"
goes stale without a ticker) · the promptless Lab's strings moved onto the labels
store with JW en+es keys (es hand-translated, flagged in JW's tracker for the
translator pass) · smoke asserts the unlock affordance · §11/ai-setup/CLAUDE.md
corrected to the decided preview contract.)*
