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
  at the bottom). **The test-RUN loop is PROVEN LIVE (2026-08-04 late):** ▶ Run in a
  column produced a real Spanish translation through `gemma-4-26b-a4b-qat-xl`
  (176→99 tok · 25 tok/s · 4.0s), registered in the AI-task strip, promotion PUT
  round-tripped — after fixing the run route's promptless 404 (below). Your QC is
  now eyes-on-the-surface, not functionality.

## THE APPROVED FIX PLAN (user: "do it all your rec", 2026-08-05) — in flight

The approved order, verbatim from the rec: **Batch 1 — Hotfixes**: docgen's
glossary-erasure chain · appearance persistence + the exact-brand-colors ruling
(q2b) · JW's two tray races (close-drain interception + Quit bypassing the
drain) + moving the invokes behind JW's bridge · JV's one-line keep-running
param fix (+ collapse its two persistences, add boot re-apply) · the
confirm-pass visibility (subscribe the two events) with its `confirming`
job-state fix. Each with its test. **Batch 2** — docgen's remaining Group 1 +
Group 2, under the ruling (approved with the rec): `flagged` = only
checked-and-flagged findings; `pending` = flagged + untranslated (the
original's intent). **Batch 3** — the review-workspace port (buckets, keyboard
layer, Google panel, terminology, skip, reviewed-marks) with the runner's
promptless test gaps pinned in the same batch. **Batch 4** — the tray family
work under the rulings: full professional menu with WORKING entries in all
three apps, JV's donor bugs fixed, localization noted, docs written.
**Batch 5** — the docs sweeps across all four repos. Deferred for rulings: the
runner's half-built no-caller surfaces, the kit-UI solo audit slice, the README
refresh, the remaining word-decisions.

**Batch 2 executed 2026-08-05** — all Group 1 + Group 2 items closed with tests
(148 pytest + lint/build + JW vitest 567 over the shared kit) EXCEPT: the
unaccept surface (accepted rows never reach the queue — the fix IS a surface,
folded into Batch 3's buckets) · "two doors" wording (rides Batch 5's docs
sweep) · **Setup targets pre-fill — DECISION NEEDED**: the audit says the
original left targets never-pre-decided; SetupView:47 pre-fills every found
locale on Check (its comment argues "facts, offered — not pre-decided").
Keep the pre-fill or match the original? Your call. · Two audit lines proved
NON-REPRODUCIBLE against the code and were compressions gone bad ("finish_run
counts failures as translated" — job `done` counts only STAGED keys;
"build_rows loops proposals twice" — one findings pass + one proposal_keys
query); the real lockout finding was "auth lockout is REACHABLE", fixed.

The audit enumerations the batches execute (pinned 2026-08-05 — they existed
only in chat, against this file's own charter):

- **Group 1 (UI/behavior defects):** unaccept is a no-op · Home renders blank on
  serverDown · no SSE reconnect · rejoining a running job never `_openTask`s ·
  a cancelled run closes its task as "done" · unseenErrors badge never clears ·
  startMany can strand a ghost queue · reviewer field saves per keystroke ·
  opening the note editor wipes a draft · silent empty catches · "gate is green
  for ." when no language · raw JSON error toasts · `?providers=online` deep
  link never consumed · select-all ignores the active filter · "loopback"
  label leaks jargon · Home language list unsorted (kit `sortable` unused).
  *(Already closed in Batch 1: the glossary-erasure chain, appearance
  persistence, the confirm-pass's two unsubscribed events + `confirming`
  state.)*
- **Group 2 (semantics vs the original's ledger):** scope semantics under the
  approved ruling (flagged = checked-and-flagged only; pending = flagged +
  untranslated) · preview drops conventionsLine + per-key notes · advisory
  accept isn't recorded · CLI `accept` still takes the retired verdict arg ·
  stale source cache after extract · auth lockout counts successes · undo's
  discard branch reports success on no-op · glossary check matches inside
  words (no boundary) · finish_run counts failures as translated · build_rows
  loops proposals twice · "two doors" wording drift · Setup pre-fills targets
  the original left never-pre-decided.
- **Batch 3's detail doc IS the original's client** (read whole 2026-08-05;
  clone: the session scratchpad's `just-ai-help/`, or re-clone the archived
  github.com/delebash/just-ai-help): `App.vue` (keyboard map + editing()
  suppression + Escape), `stores/review.js` (BUCKETS + visible + move/select +
  pickAll/pickConfirmed + mutate-refreshes-everything), `QueuePane.vue`
  (buckets + per-check breakdown + language rail + search), `KeyList.vue`
  (windowed rows + identical-bucket bulkbar + verdict chips + dots + reviewed
  class), `DetailPane.vue` (WHY plain-English map + marked placeholders +
  hard/soft flags + blur-commit + proposal Use-this/Discard + the gt-frame
  iframe + back-translate honesty copy + siblings + note + Accept/Un-accept/
  Skip/Undo), `TopBar.vue` (progress meter + scoped re-translate + cancel),
  `api.js:94` gtFrameUrl = `/gt-frame?text=…&tl=…`.
- **Batch 3 BUILT 2026-08-05:** the original's workspace ported whole — the 7
  buckets + the Accepted surface (the unaccept door) + per-check breakdown +
  search · keyboard j/k/arrows a u e g b / + Ctrl/⌘Z with typing suppression +
  Escape · windowed terse rows + identical-bucket bulk bar (pickConfirmed) +
  reviewed strike-through · detail pane: WHY plain-English map, marked
  placeholders, proposal Use-this/Apply/Discard, the `/v1/gt-frame` Google
  panel with the measured honesty copy, back-translate honesty copy, siblings,
  note, Skip · `docs/review.md` rewritten to match. Runner promptless pins
  added (stream parity · stream-404 · `_effective_think(None)` ·
  body-governed jsonMode · history contract + no-spec-row side-effect):
  32 pass in test_prompts, 761 suite (1 pre-existing environmental fail,
  tracked in the runner's TASKS). Smoke grew the workspace test (20 total).

**Batch 4 executed 2026-08-05** — the tray ruling built as ruled, all three
apps: the FULL donor menu with JV's emoji, flat like the donor, every entry
WORKING (settings/about/copy show the window and ride `tray:*` renderer
listeners; Open log file opens the server's live log Rust-side; Quit kills the
sidecar — JW through its D5 drain; JV also got its icon + kill-then-exit +
show-before-copy). Localization stays a NOTED gap (tray text English
everywhere; JW's two copy toasts ride the same item in its TASKS). Docs:
docgen settings.md · JW headless-access.md · JV system-tray.md REWRITTEN to
truth (the fiction died) · app-structure §5 teardown + §11 tray row updated.
Gates: cargo check ×3, JW vitest 567 + build:vite, JV build:vite, docgen
lint/build. **The tray itself is eyes-on QC — webdriver can't see a tray.**

## Open — needs your go (each item = the approved decision, in full)

- *(NOTE 2026-08-04 late: the e2e Setup create-flow fixture test below is BUILT —
  `smoke.test.js` "setup CREATE-FLOW…", 19/19 — kept here only until your QC;
  the audit caught me failing to close it.)* The original decision: fixture-based —
  the test creates its own scratch `en.json` inside the harness, walks the real
  Setup form's Check path → Save → asserts the server answers `loaded: true`,
  then cleans up its fixture; it never touches the real repos.

- **Cold-boot warm kickoff — MEASURED 2026-08-04, numbers say the intent holds;
  your ruling on what (if anything) to do.** The awaited chain is: `checkServer`
  (8×500 ms budget = 3.5 s ceiling) → `engine-config` GET → `refreshApplied`'s
  three parallel GETs → `retryLoad` **fire-and-forget (never awaited)**. Measured
  on this box: time-to-health **2.31 s** (real data dir) / **2.29 s** (virgin
  scratch dir — measurement-only deviation, deleted after) through the npm chain
  (the release sidecar is ≤ that); first-request GETs 3–12 ms; warm GETs ≤95 ms
  total. **Worst case awaited ≈ 2.5 s — the 14.5 s plate-sit cannot come from the
  awaited path as the code now stands.** Remaining suspects for the original
  observation: OS-cold python imports on first launch after a reboot (not
  measurable without one), or a pre-refactor boot shape. Recommendation: NO code
  change; the splash staying up during a long MODEL load afterward is the
  designed honest UI (Continue button + auto-dismiss). If the plate-sit recurs,
  re-measure time-to-health once right after a machine reboot.

- *(App-run confirmation pass: BUILT 2026-08-04 late — the job worker calls an
  injected confirm with the DONE run's byte-identical proposals; the hash carries
  the staged value so rows arrive pre-ticked on apply; a confirm failure never
  fails the run (annotation-only, `confirm-error` on the job stream). 139 server
  tests; review.md updated. Close-by-delete when your QC sees a pre-ticked row
  from an app run.)*

- **Product questions from the code-first audit (2026-08-04) — your rulings:**
  (b) The **probe** is CLI-only, so `unsure` scope finds nothing for app-only users
  (docs say so honestly). (c) **Escalation from the UI is latent** — the server
  accepts `presetId` on `POST /v1/jobs`; no view sends one. (d) `conventions.json`
  ships **Spanish only** — other languages get no paired-punctuation checks.
  (e) `POST /v1/undo` with no `lang` pops across ALL languages, and the Review page
  sends none. (f) Six routes have no caller in this app (`/v1/terms`, `/history`,
  `/accepted`, `/reference`, `/gt-frame` — which ships a third-party Google script
  with no visible entry — SINCE Batch 3 (2026-08-05) `/gt-frame` HAS its entry:
  the review detail's second-opinion panel + the `g` key — and
  `/ai/prompt-preview` is kit-consumed; `/accepted` is consumed by the Accepted
  bucket; `/history`, `/terms`, `/reference` remain caller-less). (g) About
  hardcodes `0.1.0` beside pyproject's version. *((h) glossary shape drift:
  CLOSED 2026-08-05, Batch 1 — both shapes are legal everywhere; `_glossary_list`
  in workspace.py + infer.py's normalize; tests pin it.)*

- **Test-mode links to the prompt's real data — RULED Option A (2026-08-04, in
  build):** a small kit seam, per the user: "this is our standard kit mode — we
  have props that change features slightly for specific app cases." The approved
  shape: FeatureLab accepts an optional `dataLinks` prop — the app passes its own
  targets, e.g. `[{label: "Context & glossary", href: "#/setup"}, {label:
  "Per-key notes", href: "#/review"}]` — and the kit renders them beside the
  generated prompt with a canon-worded lead ("Change what this prompt says:")
  from the manifest. Any future promptless app gets the affordance by passing
  links; nothing app-specific enters the kit; JW passes nothing and renders
  nothing. Chain: AiModelsArea forwards → FeatureWorkbench → promptless
  FeatureLab; JW's en/es catalogs mirror the new manifest key (the twin's
  toEqual).

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
  user docs in its `system-tray.md`/`run-modes.md`.
  **ALL THREE APPS SHIP IT as of 2026-08-04 late** (in git): this app AND JW got
  the full port (tray with the decided generic entries, `keep_running_on_close`
  + `set_keep_server_running`, the CloseRequested intercept — in JW slotted
  BEFORE its D5 drain grace since a kept server needs no draining, and since
  2026-08-05 (Batch 1) GUARDED by a CLOSING check above it so a mid-drain
  toggle can't intercept the drain's own close; JW's tray Quit takes the same
  400ms drain — the
  Settings → Server toggle persisted + re-applied each boot, en/es keys in JW,
  `settings.md` here); `app-structure.md` §11 codifies the family row. Gates:
  cargo check ×2 + lint/build ×2 + JW vitest, all green. **The tray + close
  behavior itself is your eyes-on QC** (webdriver can't see a tray): check both
  apps — toggle OFF ⇒ close kills everything; ON ⇒ close hides to tray, server
  stays, left-click restores, menu Quit really quits.

- **Appearance — DIAGNOSED + FIXED 2026-08-04 (your QC "doesn't work" was real,
  three defects):** the tokens defined static hex `--accent*` (so the hue slider
  changed nothing), keyed dark on the OS `prefers-color-scheme` media query while
  the kit engine stamps `[data-theme]` (so the MODE picker changed nothing), and
  only the font worked (the engine writes it inline). Fix: JV's hue-driven
  vocabulary ported into `tokens.css` (accent = `oklch(L C var(--accent-hue))`,
  dark keys on `[data-theme="dark"]`, default hue 277 = this app's indigo — the
  original 243 claim was wrong, corrected by the exact oklch conversions
  2026-08-05); the
  smoke now cycles the titlebar mode and asserts the dark stamp + restores your
  mode. Verdicts: the raw hue SLIDER stands (kit `UiColorPicker` models a full
  color string; this system is hue-driven — a swap would round-trip lossily);
  the shared JV+docgen appearance PANEL component (one kit surface both consume)
  remains open — it needs JV's donor rows lifted + both apps' gates + your QC.

- **CONTRACT BUILD — remainder under the standing go.** SHIPPED 2026-08-04 late
  (in git): the QuickSetup surgery (copy seam · family cache-offer in the kit ·
  capability gate incl. AiModelsArea:573 · onApplied seam · the 359-line fork
  DELETED · canon words by construction), the configured-state truth (band
  "Local AI is set up — <model> is the default · Re-run Quick Setup" — button
  renamed + scope line restored 2026-08-05 per your naming ruling; wizard
  "Already set up" → Change model/Close), and the once-ever `AiSetupOffer` (kit
  lift of JW's donor; docgen's permanent Home button retired, flag persisted,
  providers=online deep link fixed). 19/19 smoke against the rebuilt exe on the
  real project. ALSO SHIPPED same night: the kit TitleBar FRAME (JW's mechanics
  + docgen's post-nav settle; right side = the app's slot; docgen swapped on),
  `usePoll` exported + docgen's Home retry poll swapped (the `stores/jobs.js`
  fallback is NOT a usePoll site — a self-terminating setTimeout chain in a
  Pinia store has no component lifecycle; recorded, not swapped), JW's "General"
  section renamed **"Server"** (R1, en+es) + the **Total** disk row (R2), and
  §11 now POINTS at the manifest for words. Still open from this item:
  1. **JW swaps its local set-tabs strip for kit `SettingsShell`** — deferred
     with reason: JW already renders the canonical top-tab shape (it IS the
     donor the kit component was lifted from), so the swap is dedup, not a
     divergence fix; it needs a careful 1300-line template wrap + its own
     suite + your QC.
  2. **The raw hue-slider vs `UiColorPicker` check** — rides the appearance
     chunk's diagnosis (the shared JV+docgen surface rebuild).

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
corrected to the decided preview contract · the Option-A `dataLinks` seam (Context
& glossary → Setup, Per-key notes → Review) · **the shared run route's promptless
404 fixed IN THE SHARED STACK** (`/v1/ai/run` + `/v1/ai/stream` now accept
body-supplied system+userTemplate when no spec row exists — the kit's own header
claimed "both apps mount" these; they 404'd here; found by the first live ▶ Run,
fixed per the recorded A922 decision, 756-test runner suite green + 2 new tests).)*
