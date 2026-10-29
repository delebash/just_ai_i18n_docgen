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

---

## Records not yet distilled

Indexed by subject so they can be found; their facts move into a section above when work next
touches the subject. History in [`../plans/archive/`](../plans/archive/) is not listed.

**Consistency across the family** —
[`2026-08-04-consistency-sweep.md`](../plans/2026-08-04-consistency-sweep.md).

**The measured evidence behind every check and rule** — the retired Node original,
https://github.com/delebash/just-ai-help (`docs/HANDOFF.md`; archived).
