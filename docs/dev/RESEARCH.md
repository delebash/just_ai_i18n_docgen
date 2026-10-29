<!-- SPDX-License-Identifier: MIT -->
# Research register — what we already know, and where the proof is (just_ai_i18n_docgen)

**Read the section for your subject before researching anything** — before reading code to
answer a question, before measuring, before briefing an agent. Then grep `docs/plans` for
anything newer. The shared AI stack's facts (the kit, llama.cpp, the memory arbiter) are in
[the kit's register](../../../just-core/docs/dev/RESEARCH.md).

## The rule (family-wide, decided 2026-10-04)

The user: *"why do we keep re researching stuff, we need a primary research doc that we point to
so we dont keep duplicating or forgeting what we have done in the past"* — approved "your rec on
all go". The kit's register carries the rule in full; in short:

- **Before research:** read the subject's section here and grep `docs/plans`. An agent's brief
  carries that section and the line *"don't re-derive these; re-check one only if the code it
  cites changed after its date"*.
- **After research:** its facts land here in the same change. A research doc with no entry here
  is not done. The family guard (`../just-core/scripts/check-family.js`, check 15) fails
  any `docs/plans/YYYY-MM-DD-*.md` dated 2026-10-04 or later that this page does not link, and
  any link here that points nowhere.
- **Filled as each subject comes up.** Until then a subject's records are indexed below, so
  they can at least be found.
- One fact per bullet, then *how it was checked and when* (measured · code · web · git · record
  · agent), then where the proof is. A fact that turns out wrong is rewritten, ending "(was: …
  until <date>)".

## Automatic translation review: tools (2026-10-17)

Asked because the user wants the Spanish review done with little human interaction ("find tools
… or if need be we make tools but i want an agentic worflow").

- **docgen already has the deterministic layer and two second opinions:**
  - the checks (placeholders, plural halves, glossary, punctuation, numbers);
  - the probe (CLI only);
  - the confirmation pass for identical strings;
  - the terminology flag;
  - escalation to a stronger preset.

  It has no score of whether a translation is good, and nothing applies a string without a
  human. — *code and `docs/verification.md`, read 2026-10-17.*
- **Learned quality-estimation (QE) models, reference-free:**
  - COMETKiwi and xCOMET (Unbabel; XL 3.5B, XXL 10.7B) are under a non-commercial licence.
  - MetricX-24 Hybrid (Google; mT5, QE mode included) is Apache-2.0.

  All are trained on WMT sentence and paragraph data, a poor match for one-word UI labels, and
  all run in Python on the GPU. — *web: huggingface.co/google/metricx-24-hybrid-large-v2p6;
  inten.to's metric comparison; unbabel.com, read 2026-10-17.*
- **The LLM judge is the field's standard method: GEMBA-MQM.** An LLM marks error spans with an
  MQM category and severity. Its span precision against human annotators is low (9.0% reported).
  MQM-APE filters it: the judge post-edits each error, and only errors whose fix improves the
  string are kept, which raised reliability across eight LLMs. Generative judges do best on
  frontier models; open models under 30B are "viable" (CompactQE, EAMT 2026). — *web:
  arxiv 2310.13988, 2409.14335; aclanthology 2026.eamt-1.9, read 2026-10-17.*
- **No maintained open-source tool runs the whole loop** (review, fix, re-check, apply).
  - LocaleCI scores each string but is under FSL-1.1.
  - internationalizer and Lingo.dev validate keys and interpolation.
  - Lingoport is commercial.

  — *web search 2026-10-17; repos not yet read.*
- **Spellchecking in Node:** `nspell` 2.1.5 (MIT, wooorm; Hunspell-compatible) and
  `dictionary-es` 4.0.0 (GPL-3.0 OR LGPL-3.0 OR MPL-1.1). They catch a non-word such as
  "reviravones" with no model. — *npm registry, read 2026-10-17.*
- **The agentic review, run 2026-10-17 on the three catalogs** (4,810 strings: JustWrite 3,052,
  the kit 1,480, docgen 278), Claude agents only, no GPU:
  - a term sheet (1 agent, 201 rows), each term decided from the catalogs' own strings;
  - 6 reviewers (about 800 strings each) listed 1,282 decisions: 797 fixes, a pick in each of the
    628 strings where the file's Spanish and docgen's proposal differed, and 27 new
    translations. By category: terminology 562, accuracy 267, fluency 180, locale 63, format 7.
    The 5 critical: "Unload model" rendered "download", a string cut off mid-sentence, two lost
    `{'}'}` braces, and "Undismiss" rendered "Dismiss";
  - 2 verifiers (the MQM-APE filter, prompted to refute) upheld 1,234 and rewrote 48, 42 of them
    one capitalisation pattern ("P. ej." after a full stop); none went back to an unreviewed
    candidate;
  - a last agent ruled on the 430 strings docgen or the spellchecker still flagged: 2 fixed, 428
    accepted with a reason;
  - about 2.3 M subagent tokens and about an hour of wall time.

  — *measured 2026-10-17. The scripts were saved as docgen's tool 2026-10-18:
  [`agentic-review.md`](agentic-review.md), `scripts/review/`, `.claude/workflows/translation-*.js`
  (was: in the session's scratchpad, until 2026-10-18).*
- **The saved tool, checked on the three catalogs (2026-10-18):** export found 4,840 strings in six
  batches of about 807 and the guide assembled from the method, `lang/es.md` and each project's
  context sentence; the check failed a two-form "nota | {n} notas" for a one-form source without a
  count (placeholder-changed, brackets) and a wrong item number; a dry-run apply planned JustWrite's
  3,082 keys; findings, with docgen's acceptances honoured and only changed strings spell-checked,
  listed 0 — as docgen's summary does. — *measured 2026-10-18.*
- **The spellchecker is a hint, not a gate:** it flagged 189 strings at export, and nearly every
  hit was a valid word it lacks (preajuste, autoguardado, verb forms with an attached pronoun);
  "reviravones" was the one real non-word. — *measured 2026-10-17.*
- **A target that adds plural forms its source doesn't need is checked form by form:** each
  form of "{n} encontrado | {n} encontrados" (for "{n} found") is held to the whole source by
  the placeholder, number and bracket checks (`targetForms` in `checks.js`). vue-i18n renders
  one form, picked from the named `n` (the kit's RESEARCH §8). `checkPlural` itself runs only
  when the source has the separator. — *code and tests, 2026-10-18.* (was: the three checks
  counted across the whole string, so such a string read as `placeholder-changed` and
  `brackets`; the 17 of them were accepted as correct — until 2026-10-18)
- **A blank source string is given back as itself, with no engine call** (`loop.js`), and a
  job's confirmation pass skips it. — *code and tests, 2026-10-18.* (was: sent, it came back
  empty and ended in `failed` — the kit's `kit.quickSetup.doneBody` — until 2026-10-18)
- **Language names: `Intl.DisplayNames([uiLocale])` gives the CLDR name as it reads in a
  sentence** ("español"). CLDR's Spanish capitalises a language name standing alone or in a
  menu (`contextTransforms` → `languages`: `stand-alone` and `uiListOrMenu` are
  `titlecase-firstword`), and `Intl` exposes no capitalisation context, so `langTitle` in
  `src/services/langs.js` capitalises the first letter. — *web:
  github.com/unicode-org/cldr-json, `cldr-misc-full/main/es/contextTransforms.json`; Node 24's
  ICU, measured 2026-10-18.*

## The template's standard: server guards, release, launchers (2026-10-24)

Asked while moving docgen onto the kit template's files (TASKS, "docgen on the template's
standard").

- **docgen's Linux executable is `just_ai_i18n_docgen`** — electron-builder names it after
  package.json's `name`, sanitized and lowercased, when `linux.executableName` is unset; the
  template's shell launcher derives the executable from its own stem (`<stem>-server`), which
  for docgen is `just-ai-i18n-docgen`, so docgen's script names the executable itself (as its
  .cmd names `just_ai_i18n_docgen.exe`). — *code: app-builder-lib `linuxPackager.js` l.15–16,
  builder-util `sanitizeFileName` run on the name, 2026-10-24; the script dry-run with a stub
  executable.*
- **The kit's restore hooks get a handle with no tables registered** — `beforeCopy` / `afterCopy`
  run on the restore's own `openDatabase` connection, `scrubBackup` on the backup's copy; there
  `h.get(table, key)` throws ("give the key as {column: value}"), so appmeta's settings take the
  key as `{key}` and an optional handle. — *code: core `platform/sql.js` `pkOf`,
  `platform/data_api.js` `copyTables` / backup, 2026-10-24.*
- **The release's `--default-data` check needs `dataDir` in `GET /v1/health`** — docgen's health
  had none, so the release would have stopped there; it now answers it, as the template's.
  — *code: `scripts/start-packaged.js`, 2026-10-24.*
- **The release's start checks pass on Windows** — the installer built as the workflow builds it
  (`quasar build -m electron -T win32 -P never`: `latest.yml` and the `.blockmap` written, the
  .cmd launchers beside the exe, no shell script there); `start-packaged.js` window answered in
  2.4 s, `--headless` in 1.0 s with `/` and its script 200, the `--default-data` pair on one
  folder. macOS and Linux unrun (no runner here). — *measured 2026-10-24.*
- **The kit's fonts reach the build** — with `~@delebash/ui/common/fonts.css` in
  `quasar.config.js > css`, `npm run build:spa` writes 242 woff/woff2 files to `dist/spa/assets`.
  — *measured 2026-10-24.*
- **The CLI's shell launcher (macOS/Linux, 2026-10-28)** — the server's launcher with `cli.js`;
  dry-run with a stub executable: it runs `<here>/just_ai_i18n_docgen` on
  `resources/app.asar/node_modules/just-ai-i18n-docgen-server/src/cli.js` with the arguments,
  `ELECTRON_RUN_AS_NODE=1`, `NODE_USE_SYSTEM_CA=1` (a value already set kept). The builder ships
  every non-.cmd launcher on both. macOS's branch unrun (no runner here). — *measured 2026-10-28.*
- **JustWrite's website rebuilds on a release through a secret** — its repo holds
  `WEBSITE_DISPATCH_TOKEN` (set 2026-06-04), and its v2.0.0 release run (01:20 UTC 2026-10-29) was
  followed by justwrite-website's `repository_dispatch` deploy at 01:28. Not the way: the user,
  2026-10-28 — "each app website should run its own via something like npm run deploy other github
  workflows shouldnt be running other workflows jw is wrong". docgen's release leaves `WEBSITE_REPO`
  empty and its site's deploy.yml runs only by hand (`npm run deploy` in the site's repo). —
  *`gh secret list`, `gh run list`, 2026-10-28.*
- **npm audit, 2026-10-28** — docgen's root lock: jsdom's `undici` 8.11.2 → 8.12.3 and Quasar's
  `serialize-javascript` 7.1.2 → 7.1.4 (`npm audit fix`, no --force); `src-electron/`'s lock:
  `fast-uri` and `@electron/get`'s `undici`. Left, the kit's to move: the kit core's own `undici`
  8.11.2 (its lock; it ships in docgen's server — `dist/electron/UnPackaged/package-lock.json`)
  and Electron 44.7.0 (GHSA-jr5w-w6x2-84p9, fixed in 44.10.0). — *`npm audit`, `npm ls`.*
- **The maintenance gate holds every write by default** — a restore waits for the writes already
  running (an AI run's POST included) and refuses new ones with 503 and Retry-After; docgen
  passes no `isDataWrite`, as the template. — *code: core `platform/maintenance.js`;
  `server/tests/data.test.js`, 2026-10-24.*

## A run on the kit's jobs (round D2, 2026-10-28)

Asked while moving a translation run off docgen's JobManager onto the kit's job registry (the
kit's plan `docs/plans/2026-10-24-engines-the-llama-way.md`, round D2; TASKS).

- **The kit's registry lists running jobs only** — `GET /v1/jobs?kind=` answers the ones still
  running; a finished job stays readable by id for 10 minutes (`keepMs`), then its end only (410).
  docgen's `/v1/jobs/current` answered the last run until a project load or a restart, so the Runs
  page's card for a finished run now reads the newest run record (`state.js`: `state`, `error`,
  `total`, `failedKeys`). — *code: core `platform/jobs.js` `list`, `sweep`, 2026-10-28.*
- **A job ends "done" whenever its work returns, cancelled or not** — only a throw while aborted
  (or an AbortError) ends it "cancelled". The loop reports a cancel on a batch boundary
  (`cancelled: true`), so the run throws an AbortError after staging; a Cancel during the
  confirmation pass or during the LAST batch still ends "done" (the loop checks before each batch
  only — as the JobManager did). — *code: core `platform/jobs.js` `start`; `server/src/loop.js`,
  2026-10-28.*
- **The data router calls `beforeReplace` for a restore only** — a reset runs `runReset` alone,
  so `resetWorkspace` cancels the run itself (house-paint's `teardown`, the same split). The gate
  never waits on an open event stream: GETs pass it uncounted. — *code: core
  `platform/data_api.js` l.943–987, `platform/maintenance.js` l.65, 2026-10-28.*
- **`runServerJob` before kit 0384b39 had two gaps docgen hit** — the job's end never reached
  `onJob` (a store keeping the job stayed "running"), and a job cancelled anywhere but its own
  task (another window, the Runs page's Cancel, a restore) failed the task red; both fixed in the
  kit at docgen's ask. — *code: ui `services/serverJob.js`, `services/appTask.js` l.91,
  2026-10-28.*
- **The strip shows its own `done/total` when a task gives no text** — so the run's `describe`
  returns that readout and needs no catalog word. — *code: ui `components/AiTaskStrip.vue`
  l.136, 2026-10-28.*
- **A real run in the real window, end to end** — Runs → Translate (Spanish, pending) on docgen's
  own project: 7 keys, 1 request, 21.2 s with Gemma 4 26B loading first; a reload mid-run found it
  again (the card "Running", the AI-tasks count 1); it ended "Last job · 7/7 staged · state: done"
  with no red badge, Home counting "7 staged", the record `state: done`, `total: 7`, no
  `failedKeys`. The 7 proposals were discarded after (the approved check), es.json untouched. —
  *measured 2026-10-28, the unpacked build, kit 0384b39.*
- **docgen lacked three of the kit's UI peers** — `@internationalized/number`, `dom-accessibility-api`
  and `qrcode` (the kit ui package's `peerDependencies`); builds resolved them from the kit's own
  `node_modules` beside it. Installed at the template's ranges, in devDependencies with the
  renderer's other bundled libraries (Quasar alone sits in dependencies). — *code: ui
  `package.json`, 2026-10-28.*
- **The kit's StoragePanel offers no move while the data-dir variable names the folder** (`setBy`):
  under the e2e driver (which sets `JUST_AI_I18N_DOCGEN_DATA_DIR`) it says "This data folder is set
  by JUST_AI_I18N_DOCGEN_DATA_DIR — change it there" in place of Change folder… — docgen's own panel
  offered the move anyway. — *measured 2026-10-28, the unpacked build.*
- **docgen's eight new Spanish strings by the agentic review's `--new` run** — export 8 (all
  NO CANDIDATE), the translator's entries clean but one spelling hint (`preajustes`, the term
  sheet's word), one refuting verifier overturned 0 of 8, apply 8 saves, docgen's check 266/266.
  The Workflow steps were done as a translator (this session) and one independent verifier agent,
  the workflows not being opted into. — *2026-10-28.*
- **A capture while the app loads its model shows the start-up load over every page** — the
  window's boot warm-loads the routed model (BootModelLoad, "Loading it into your graphics card"),
  and `npm run screenshots` saved that screen as home, setup, review and runs (~1.57 MB each).
  With the model loaded first, the pages come out. — *measured 2026-10-28.*

## The 2026-10-29 round: the English record, run checks, prompt rows

Asked while building the user's approved list of 2026-10-29 (TASKS; the session's 22 items): the
command line's overwrite, the translation cache's retirement, the run-start checks, and translate /
confirm / review moving onto the kit's prompt rows.

- **The command line's translate wrote over reviewed strings whenever the project's context
  changed** — the delta kept a translation only while its cache key matched, and the key held the
  context's and the glossary's hashes (`shieldlib.js` `cacheKey`, until 2026-10-29). JustWrite's
  context changed in justwrite-app 1518401 (2026-10-17 16:16), after the cache's last write (16:14):
  its next command-line translate would have re-sent and overwritten about 3,028 reviewed strings.
  — *code + measured by an agent's read-only script, 2026-10-29.*
- **The app's runs never read the cache** — a job passes `force: true` and an empty `existingFlat`
  (`jobs.js`); only the command line's translate did. Its hit rate on the delta: JustWrite 156 of
  3,184 keys, docgen 246 of 253. — *code + measured, 2026-10-29.* The cache is gone; its file
  (`.just-ai-i18n-docgen-cache.json`, which projects' `.gitignore` already covers) holds the English
  each translation was made from now (`sources.js`).
- **Keys translated before the English record existed are recorded as current the first time a
  language is seen** (`seedSources`) — an English change made before that first look can't be
  found; every later one is a `source-changed` finding. — *code, 2026-10-29.*
- **A run with no usable engine failed every key slowly** — `makeSend` resolved the preset only
  inside each call, so the route's 400 never fired and each key spent the whole retry ladder. It
  resolves once when the run is made now, and a setting error ends the loop (`fatal`). — *code,
  2026-10-29.*
- **The kit's 28 tooltips showed nothing in docgen** — the `v-tooltip` directive was never
  registered (the template's boot registers it). — *code, 2026-10-29.*
- **Review's Google Translate frame never loaded in the desktop window** — the shell's `app://`
  CSP had no `frame-src`, and its `cspAdd` could only extend directives the default listed; the
  kit's 836d134 added both `cspAdd` of a new directive and `resourceIsolation`'s `framePaths`. —
  *code, 2026-10-29.*
- **Electron's install script didn't download the binary** (npm's `allowScripts` gate): the app
  wouldn't start until `node node_modules/electron/install.js` ran. — *measured 2026-10-29,
  Electron 44.10.0.*
- **Today's prompts are reproducible byte for byte from rows rendered by the kit, with the
  optional rules composed in code** — 198/198 of JustWrite's batches and 17/17 of docgen's for
  translate, every key (3,165 and 261) for confirm and back-translation, each with every optional
  field set, all empty, and a context holding `{{items}}`, `$&` and `$1`. The values-only form (the
  rule wording in the row) scored 0/199 once the optional fields were empty: it leaves "never
  translate these terms: ;" behind. — *measured 2026-10-29 (scratchpad `measure/bytes.js`,
  `measure2/bytes.js`); `tests/prompts.test.js` holds golden strings.*
- **The kit's renderer never reads an inserted value as a template** — `render` replaces each
  `{{name}}` once through a function, so a context sentence holding `{{items}}` is sent as written.
  — *code: core `llm/prompts.js` `render`; test, 2026-10-29.*
- **runAction differs from docgen's old send in four ways** — thinking is off under a JSON contract
  (`_effectiveThink`; docgen sent the preset's think with the schema, and the seeded presets have it
  off); the schema's name is the action key (`translate`, was `translations`); float tunables go as
  `PyFloat`s; and a preset with no model makes the provider's default model resident first (the old
  send loaded a model only when the preset named one). It adds the busy guard and the usage ledger
  the direct `adapter.chat` call bypassed. — *code: core `llm/prompts.js` `_effectiveThink`,
  `_responseFormat`, `_plane2Extra`, `ensureLocalReady`, 2026-10-29.*
- **The kit's model refusals carry `localNotReady`** (the model just stopped by the user, the engine
  not installed, a load that failed or timed out); retried per key each would load the model again,
  so a run ends on one. — *code: core `runner/lifecycle.js` `ensureModelReady`, 2026-10-29.*
- **runAction had no way to run a chosen preset** — escalation needs it; passing provider, model and
  temperature as overrides still mixed in the assigned preset's samplers and top_p. The kit's
  df6ee66 added `RunRequest.presetId`. — *code, 2026-10-29.*
- **The kit's Lab showed the app's data links only on a prompt-less pane** — the row Lab dropped
  docgen's Context & glossary and Notes doors; the kit's 8bdc2f7 shows them under the test input. —
  *code: ui `components/FeatureLab.vue`, 2026-10-29.*
- **The 40-key stress corpus, rebuilt** — the original's was never committed (just-ai-help's tree
  has no corpus or evidence file; its `docs/models.md` only describes it). Rebuilt from JustWrite's
  en.json of 2026-10-29 to that description, each count exact: 8 plural-pipe forms, 20
  interpolations, 10 long paragraphs (160+ characters) with named slots, 7 glossary keys, 15 short
  labels (three words or fewer, 3 of them questions); glossary terms only in the glossary group;
  each group evenly spaced over the catalogue's key order. The keys: count.scene, count.concern,
  count.looseThread, count.chapterDone, richEditor.pendingChanges, projectReplace.matchCount,
  characterProfile.applyAction, settings.wbCategories.deleteMessage, plotBoard.intro,
  sessionRecap.threadsBlurb, relations.intro, markers.emptyBody, foreshadowing.reviewDesc,
  readerKnowledge.intro, analysisView.driftBlurbSet, groups.introList, timeline.intro,
  settings.backups.thisBookHint, common.countOf, home.viaModel, export.docxTerm,
  export.stage.loadingEpub, boot.splashAlt, export.zipJvNote, commandPalette.sub.export,
  settings.coverImage.hint, chapters.ai.twistsDesc, plotBoard.dialog.deleteTitle, chat.deleteTitle,
  stuck.eyebrow, nav.home, beatSheet.frameworkLabel, sceneLinks.newStrand, chat.storyBibleTerm,
  richEditor.textColorTip, analysisView.milestones, commandPalette.act.toggleSidebar,
  panes.search.eyebrow, settings.appearance.preset.editorial.name,
  characters.sections.voice.title. — *2026-10-29 (scratchpad `m12/corpus.js`).*
- **Gemma 4 12B (QAT) beside the 26B on that corpus** — one run each, the command line's
  `translate --no-confirm --force` on a copy of docgen's data folder (JustWrite's context and
  glossary, Spanish, the seeded preset: temperature 0.2, thinking off; `JUST_AI_HOME` isolated so
  the family registry wasn't written), nothing else on an RTX 2070 SUPER 8 GB with 32 GB RAM, each
  from a cold model load:
  - **12B**: 40/40, 3 requests, 109.0 s; 0 structural; 2 flags, both false positives ("Editorial",
    "PDF / DOCX / EPUB" are right unchanged); 3 real errors after reading — "Setups your manuscript
    plants" read as the verb "Configura", "Pin any" as Spain's "Pincha" (it wrote "Fija"
    elsewhere), `{atLeast}` placed after "métricas".
  - **26B**: 40/40, 3 requests, 57.7 s; 0 structural; the same 2 false positives; 5 real errors —
    "back" as "de respaldo" (backup), graph "edges" as "bordes", "Stuck?" as "¿Necesitas ayuda?",
    "Drop one" as "Suelta uno", the same `{atLeast}` placement.
  - 24 of the 40 came out identical. One run each at temperature 0.2 is within sampling noise
    (the original saw a single flag not reproduce), so this says the 12B is as accurate here, not
    more; the 26B's "most accurate" rests on the original's corpus and the 1,965-key live run.
    Both keep every Spanish question's opening ¿. — *measured 2026-10-29 (scratchpad
    `m12/run-*.log`, `m12/es.12b.json`, `m12/es.26b.json`).*
- **An app's catalog rows never get a revised seeded text on an existing install** — the kit's
  `seedExtraCatalog` fills only size, draft and physics facts on a row that's there; the known-stale
  heal (QC-43a) covered the kit's own built-in catalog only. The kit's 5189ddb added
  `modelCatalogHeals` (a field swapped only while it is exactly a listed old seeded value);
  docgen registers the 12B row's old description and notes, copied from git, and the user's own
  database held exactly those. — *code: core `llm/seed.js` `seedExtraCatalog`; read-only query of
  docgen's `data/app.db`; test `app.test.js`, 2026-10-29.*
- **docgen's nine new Spanish strings by the agentic review's `--new` run** — export 9 (all NO
  CANDIDATE: the Lab's language word, Settings → General's four, the source-changed explanation, the
  not-found page's three); no Spanish donor (the template has no es.json, JustWrite lacks the
  keys); the translator's entries clean but the expected `untranslated` on "General"; one refuting
  verifier overturned 0 of 9; apply 9 saves, "General" accepted with its reason, docgen's check
  262/262, exit 0. This session translated and one independent agent verified, the workflows not
  being opted into. — *2026-10-29 (scratchpad `es-new-1029/`).*
- **The prompt rows, end to end in the real window** — Runs → Translate, Spanish, scope all, on
  docgen's own project: 262/262 keys, 17 requests, 160 s with Gemma 4 26B, 0 failed, state done; the
  strip on Runs and on Home ("Translating Spanish 16/262 … Cancel"); the confirmation pass ran
  through the confirm row after it (7 "same" verdicts in 9 s, the identical keys' rows pre-ticked);
  the 262 proposals discarded after, es.json untouched. — *measured 2026-10-29, the unpacked build,
  kit a911599.*
- **Review's Google Translate frame loads in the desktop window** — the iframe's `/v1/gt-frame`
  page loaded, the Google widget mounted in it, no console error. — *measured 2026-10-29.*
- **No driver can attach to any family app's packaged build** — all five (docgen, JustWrite,
  JustVoice, house-paint, the template) set the fuse `enableNodeCliInspectArguments: false`, so
  Playwright's `_electron.launch` times out on it; the e2e drives `build:unpacked`. And every app's
  `build:unpacked` is Quasar's `--skip-pkg`, which skips installing the app's dependencies, so no
  unpacked build can start its own server — its server exits with ERR_MODULE_NOT_FOUND for
  `node_modules/<server>/src/serve.js`; the e2e runs against a server started first. All five on
  Electron 44.10.0. — *measured + code (Quasar `electron-builder.js` `#packageFiles`), 2026-10-29.*
- **A server already on the port is asked to stop** (the kit's shutdown route + the shell's
  `shutdownPath`): the unpacked and the packaged app each sent it `POST /v1/shutdown`, and it logged
  "shutdown requested from 127.0.0.1 — stopping engines, then exiting". — *measured 2026-10-29.*
- **The tray, as a person uses it** (the packaged build, Windows 11, through UI Automation): the
  icon sits in the "Show Hidden Icons" flyout (`TopLevelWindowForOverflowXamlIsland`), its name the
  tooltip with a leading space (" Just AI i18n & DocGen"); with keep-running off the window's close
  quits the app and stops its server; on, the close hides the window and both stay; the icon's
  left-click shows the window again; the menu's Quit stops every process and the server. The menu
  read "Quit Just AI i18n  DocGen" — Windows takes "&" as a menu mnemonic; the kit's ca087d0 escapes
  it. — *measured 2026-10-29.*
- **The site's `/docs/` index comes only from an app's `docs/README.md`** (the kit's sync-docs);
  docgen's own retired script wrote it from `toc.json`, so on the kit's script the sidebar's
  `docs` entry had no page and the site's build failed. docgen has a `docs/README.md` now, as
  JustWrite does; the in-app Help takes it as its index. — *code + measured (site `build:local`),
  2026-10-29.*
- **The single-source text system needs no change in docgen's `extract`** — it writes `lede.<slug>`
  and `hints.<slug>.<field>` from a doc's front-matter and round-trips a nested catalog: over
  JustWrite's docs and en.json, `extract --check` answered "27 doc(s), 0 with front-matter → 0
  key(s), up to date", the file byte-identical. The work is JustWrite's (its toc `hint`s are English
  literals shown untranslated, and its docgen config has no `docsDir`), the kit's (its help renderer
  must strip front-matter — b8551d2) and its website's; handed to those sessions with the steps. —
  *measured 2026-10-29 (read-only); JustWrite's `docs/plans/2026-07-26-i18n-single-source-research.md`.*
- **A restore re-ran only docgen's settings seed** — the template's runs the whole seed
  (`seedWorkspace`), so a backup from before the prompt rows restored without them and no run could
  start until a restart. — *code + test (`data.test.js`), 2026-10-29.*

---

## Records not yet distilled

Indexed by subject so they can be found; their facts move into a section above when work next
touches the subject. History in [`../plans/archive/`](../plans/archive/) is not listed.

**The measured evidence behind every check and rule** — the retired Node original,
https://github.com/delebash/just-ai-help (`docs/HANDOFF.md`; archived).
