# The docs cleanup campaign — verdict tables (2026-08-04)

The user's ruling (2026-08-04): "clean up all docs, verify all in code, archive all
completed plans, and move any pertinent data to tasks, ideas, or dev docs — this is
getting bad." Survey DONE (three read-only agents + an inline pass).

> ✅ **EXECUTED 2026-08-04 in all four repos** (the user's "go do it all your rec"):
> trackers created in runner + JV and the placement rule applied family-wide;
> facts extracted; banners landed; archives moved with the grep gate run before
> and after; live references repathed; the port registry corrected to JV 17494;
> `check-consumers.py` gained the docgen root (and passes ×3). HELD for the
> user's named rulings: JW `2026-06-20-deep-audit.md` (merge call) · JW think-A/B
> RESULTS doc (run-or-kill) · JV root strays DESIGN_FREEZE/CONTRACT/FEATURES ·
> JV roundtrip-slice1 + JV deep-audit · runner big-batch triage. The verdict
> tables below are the campaign's record.

Verdicts: **keep-live** (referenced/open) · **banner-close** (shipped; add a COMPLETE/
SUPERSEDED banner in place) · **archive** (move to `docs/plans/archive/` in that repo)
· **update** (live doc, stale claims listed) · **unclear** (needs the user's ruling).

**Execution order per repo (corrected 2026-08-04 after the re-think — refs LAST,
because moves break them again):**
1) **Extract** every "open fact" to its real home (TASKS/IDEAS/dev docs). Each new
   tracker line is marked either code-verified (agent evidence at file:line) or
   ATTRIBUTED (claimed by the plan doc, not re-verified — say so in the line).
2) **Banners** on every banner-close + any archive-verdict doc missing one. Banners
   land before moves, so even a "skip the moves" ruling leaves every dead doc marked.
3) **Archive moves**, gated: grep every moving filename across ALL FOUR repos before
   (enumerate citations) and after (prove zero dangling links). Most archive-verdict
   docs already carry banners — their only work IS this move.
4) **References + update-verdict claims fixed LAST**, against the final layout.

**Tracker-closure rule:** a tracker line whose file:line went stale is NOT a fixed
bug — correct the pointer; close only when the UNDERLYING issue is verified dead in
code. (Live example: JW TASKS:47's `v0.1 · local` — the string moved from Sidebar.vue
into `en.json:1534`; the frozen-version-label bug likely still lives there. Verify
en.json before touching that line.)

**Tracker-placement rule (per-repo convention):** an item lives where the code that
closes it lives — kit/shared-server → runner's (new) tracker, JW app → JW, JV → JV.
Creating runner + JV `docs/dev/TASKS.md`+`IDEAS.md` is part of their gos; runner's
absorbs the kit items currently in JW's tracker; JW's header becomes a pointer map.

Rollup: docgen 8 docs (2 banner-close, 1 update-decision) · runner 58 (6 keep-live ·
24 banner-close · 22 archive · 2 unclear; 14 TASKS-candidates + 7 IDEAS-candidates) ·
JW 92 (8 keep-live · 16 banner-close · 31 archive · 1 unclear; 9 homeless facts;
README = heaviest drift in the family) · JV ~75 light (no live tracker at all; 3
actively-misleading docs; 1 dead user doc).

---

## 1. just_ai_i18n_docgen (surveyed inline)

| doc | verdict | why |
|---|---|---|
| `docs/dev/TASKS.md` | keep-live | The live tracker; stale commit claims fixed 2026-08-04. |
| `docs/dev/IDEAS.md` | keep-live | Conforms; empty holding pen. |
| `docs/plans/2026-08-04-consistency-sweep.md` | keep-live | Active enforcement list + QuickSetup resumption notes. |
| `docs/plans/archive/2026-08-04-kit-reuse-audit.md` | banner-close | Every finding landed same day (one splash, BootModelLoad, PNG deleted); §1's "open ruling" was ruled (model name = shared). |
| `docs/superpowers/specs/2026-08-03-design1-chrome-design.md` | banner-close | Chrome shipped 08-03/04. **Homeless fact:** its deferred pair — `make_data_router` (backup/restore/reset) + `UpdatesPanel` — has no TASKS/IDEAS line and the doc points at the retired repo's HANDOFF for it. |
| root `README.md` | DECISION | Still the create-tauri-app template stub; says nothing about the app. Write a real one, or leave-by-standard. |
| root `CLAUDE.md` | update (1 fix) | "Port 8742 (JW 17495 · **JV 8741**)" — JV is actually **17494** (`JustVioce/src-tauri/src/lib.rs:46`). Same wrong value in `src-tauri/src/lib.rs:22`'s comment. |
| `e2e/README.md` | keep | Verified: carries the "never drive :8742 while the dev window is open" law (line 65). |

**Open facts needing a home:** the data-router + UpdatesPanel deferred pair (→ TASKS
or IDEAS on the go).

---

## 2. just-llm-runner (agent survey, code-verified)

**Confirmed gaps:** `docs/dev/` does not exist (no TASKS.md / IDEAS.md — the only
family repo besides JV without them); no `docs/plans/archive/` folder. Zero
`just-ai-help` references.

### Root + docs/

| doc | verdict | why |
|---|---|---|
| `README.md` | keep-live (2 fixes) | Names a `runner.py` that doesn't exist (real: `llm_runner/runner/lifecycle.py` + `process.py`); "~710 tests" vs CLAUDE.md's "717 pass" — pick one. |
| `CLAUDE.md` | keep-live (3 fixes) | :61 calls `runner-manifest.json` "the drift-prone shared data" — the file is GONE (README:53 says so); :75 points at `../justwrite-app/docs/TASKS.md` — dead path (now `docs/dev/`); :73 routes "THE ledger" through the outstanding-master-plan whose own header redirects to the JW tracker via the same dead path. |
| `docs/app-structure.md` | keep-live (audit below) | THE family standard; 3 stale claims + 3 stated-universal rules its own canonical donor (JW) violates. |
| `docs/llama-cpp-watch.md` | keep-live (stale anchors) | Adoption ledger, last reviewed 2026-07-14 (21 days cold); `config.py:39` → real :49; `lifecycle.py:296-306` → real :356; both JW tracker refs dead-path'd. Nothing reads it except one plan doc. |

### app-structure.md claim audit — the STALE/unadopted list

- **"JV 8741" is WRONG — JV is 17494** (`JustVioce/src-tauri/src/lib.rs:46`); 8741
  survives only in JV's `scripts/smoke.js:29`. The wrong value is propagated into
  docgen (`src-tauri/src/lib.rs:22` comment + root CLAUDE.md).
- **§11 "controls over `setAppearance`"** — no such export; the function is
  `applyAppearance` (`ui/src/common/services/appearance.js:210`).
- **§11 prompt-preview contract** claims `{feature, lang?, keys?}` — the kit sends
  only `{feature}` (`FeatureWorkbench.vue:235`). Server implements the fuller shape.
- **§4 rules stated as universal that JW violates:** `installLlmUi` (JW hand-calls
  `configureLlmUi`/`configureServerApi`/`configureExternal`, `main.js:37,42,50,55`),
  `<LlmUiHosts />` (JW mounts `<Toast />` + `<AppDialog />` individually,
  `App.vue:192-193`), `useAiTasksNav()` (JW's row is hand-built, `Sidebar.vue:148`).
  Either JW converges or the standard records the deviation.
- **§2 contract vs reality:** docgen fully conforms (all 11 script names); JW has no
  `lint` script and `"server"` targets `justwrite_server.cli`; **JV is far out of
  contract** — bare `python` (no `scripts/py.js`), no `lint`/`test`/`test:server`/
  `screenshots`.
- **Structural:** the standard for Tauri apps lives in the library repo, which can
  satisfy almost none of §1/§2/§5/§10/§12 itself — no section says so.
- Everything else checked TRUE at exact file:line (ports JW/docgen, alias+dedupe,
  §11 chrome exports, boot-splash claims, QuickSetup trap line, platform routers).

### docs/plans/ (54) — rollup: keep-live 6 · banner-close 24 · archive 22 · unclear 2

**Keep-live (6):** `2026-07-05-model-surface-build` (Phase 5 residency knobs still
gated behind `v-if="installed"` — `LuRunnerEngine.vue:275`; Phase-4 auto-description
open) · `2026-07-06-outstanding-master-plan` (THE AI-stack ledger; CLAUDE.md:73
points here; carries the live NOT-BUILT tail F2/F4/F5/I2/I3/D5; its tracker pointer
is dead-path'd) · `2026-07-15-preset-one-source-rewrite` (CLAUDE.md:74 names it the
current model; header self-contradicts — ":3 awaiting go" vs ":172 ALL STAGES BUILT";
:172 is correct per code) · `2026-07-16-feature-model-system-current-state` (a
reference doc mis-filed under plans/ — promote to `docs/` proper) ·
`2026-07-19-cpu-only-band-test` (RECIPE, empty results table, waiting on the box) ·
plus `docs/llama-cpp-watch.md` counted above.

**Unclear (2, need the user):** `2026-07-08-big-batch-queue` (510 KB; header says
batches 4–6 carry a STANDING GO §8 + "B2-9 NOT covered" — needs a human triage pass
to extract what's still open) · `2026-07-17-load-cancel-and-one-progress-control`
("building"; :149 "T5 is therefore NOT BUILT" — needs a T-by-T verdict).

**Banner-close (24):** 2026-07-01-engine-binaries-download-fix ·
2026-07-02-model-switch-connect · 2026-07-04-serving-vram-manager-implementation ·
2026-07-04-serving-vram-manager (P4 → open fact) · 2026-07-06-a-to-e-execution ·
2026-07-06-providers-surface-redesign · 2026-07-14-acceleration-backend-selector ·
2026-07-16-reasoning-budget-house-layering (labeling law → IDEAS) ·
2026-07-17-provider-native-dialects-plan · 2026-07-19-builtin-provider-collapse ·
2026-07-19-draft-fit-floor-and-lab-measure · 2026-07-19-dspark-drafter-detection ·
2026-07-19-modal-scrim-and-drag (drag invariants → IDEAS) ·
2026-07-19-one-acquire-download-draft · 2026-07-20-model-list-rules ·
2026-07-20-pypdl-concurrent-downloads · 2026-07-21-builtin-row-engine-update-and-warm-load
(still describes app-local warm shape; re-homed to kit `warmBoot.js` 2026-08-04) ·
2026-07-21-drafter-loadability-guard (dead IDEAS path) ·
2026-07-21-one-engine-then-load-flow (cites deleted `warmStartup.js:48`) ·
2026-07-26-pc-class-config-rename · and 4 more recorded in the survey.

**Archive (22):** the June research/superseded set — 2026-06-23-shared-component-
architecture · 2026-06-24 ×4 (llamacpp-switches, quicksetup-redesign, server-model-
management-brief, small-vram-multimodel-research) · 2026-06-25-serving-architecture-
research · 2026-06-27 ×5 (MASTER-PLAN, catalog build/rec/evidence, speaker-attribution
research) · 2026-06-28-MASTER-PLAN (510 KB, self-banner'd historical) ·
2026-06-28-ai-state-grid (**needs banner first** — its "5 menus" claim reads current
and is stale: today 3 areas, `AiModelsArea.vue:4`) · 2026-06-29 ×2 ·
2026-07-01-taskkind-routing (taskKind deleted 07-15) · 2026-07-02 ×3
(gguf-grounded, preset-model-a-resets, user-tasks-model) ·
2026-07-03-model-setup-simplification · 2026-07-05-catalog-tune-providers-phase ·
2026-07-06-model-per-hardware-plan · 2026-07-08-segmented-downloads-plan (built,
then replaced by pypdl) · 2026-07-14 ×2 (feature-override plan, thinking-budget
discussion) · 2026-07-19 ×2 (cpu-inference-research, panel-dismiss-and-no-dim).

### Open facts needing a home — TASKS candidates (runner)

1. Phase 5 — residency knobs before engine install (`LuRunnerEngine.vue:275` still
   gates them behind `installed`).
2. Phase-4 remainder — auto-composed model description (never built).
3. SVM P4 — resident-set + TTL UI ("needs a fresh go") + its two pending on-box checks.
4. CPU-only band box test — recipe with an empty results table; a product decision
   is blocked behind it.
5. T5 — real VRAM-load percentage (load-cancel plan; NOT BUILT).
6. JW has not adopted `installLlmUi`/`<LlmUiHosts />`/`useAiTasksNav` — converge or
   record the deviation in §4.
7. JV out of contract on §1/§2 (port 17494 vs the registry's 8741, no py.js, missing
   scripts).
8. **`scripts/check-consumers.py:45-48` doesn't know `just_ai_i18n_docgen/server`**
   — the "deleting a shared export fails HERE" guarantee has a hole at the newest
   consumer.
9. llama-cpp-watch review 21 days stale; CUDA Q2_0 watch item never re-checked.
10. Outstanding-master-plan NOT-BUILT tail: F2 (speaker-attribution scaffolding),
    F4 (JV EngineManager→arbiter hook), F5 (JV appearance knob-set), I2 (cloud
    prompt caching), I3 (Apple-Silicon fit/tune).
11. Big-batch-queue batches 4–6 standing go + "B2-9 not covered" — triage.
12. Pre-existing red: JW headless smoke `provider-form search=false` surface.
13. Known-bad test `test_pci_gpus_linux_lspci_name_match` on Windows — recorded in
    CLAUDE.md/README, tracked nowhere.
14. Create `docs/dev/TASKS.md` + `IDEAS.md` here; repoint CLAUDE.md:75.

### IDEAS candidates (runner)

Ternary Bonsai / Q2_0 lab A/B (post-upstream) · the six unadopted llama.cpp
adoption candidates from the 07-14 review · D5 remote curated catalog (PARKED by
user word) · the labeling law ("a switches row is a real engine switch or SAYS it
isn't") · the modal-vs-panel dismissal fence · draggable-modal invariants ·
`_ENGINE_UNSUPPORTED_ARCHS` append-ritual.

### Stale cross-references (runner)

CLAUDE.md:75 → dead tracker path · CLAUDE.md:61 → deleted manifest ·
llama-cpp-watch :32/:27/:37 line anchors + :61-62 dead paths ·
app-structure.md:329 `setAppearance` → `applyAppearance` · app-structure.md:28 JV
port · outstanding-master-plan:438 dead path · drafter-loadability:3 dead path ·
one-engine-then-load → deleted `warmStartup.js` · ai-state-grid:241 "5 menus" ·
README `runner.py` · test-count mismatch · check-consumers.py roots ·
preset-one-source header self-contradiction.

---

## 3. justwrite-app (agent survey, code-verified)

### Root

| doc | verdict | why |
|---|---|---|
| `README.md` | **UPDATE — heaviest drift in the family** | Describes a pre-server app: `src/renderer/` tree (doesn't exist; vite root is repo root), `.mjs` script names (all `.js`), deleted `src/services/openai-compat.js`, "no linter on purpose" (biome.json + i18n:lint exist), dev "falls back to IndexedDB" (false; `backups-and-data.md:116` says the opposite), "msedgedriver for your Edge version" (targets the WebView2 runtime, `e2e/scripts/fetch-driver.js:38`), npm-scripts table missing test:unit/test:server/test:fast/i18n:*/bench/dup/smoke, and **no `server/` anywhere** though CLAUDE.md calls it required. |
| `CLAUDE.md` | keep (3 fixes) | :92 `eslint.i18n.config.mjs` → real `.js`; :69 help glob quoted at wrong depth (`helpDocs.js:14` uses `"../../docs/*.md"`); :21-22 stale test counts (429/121 vs the current 567 vitest). |
| `AGENTS.md` | not surveyed | Flagged only. |

### docs/dev (8)

| doc | verdict | why |
|---|---|---|
| `TASKS.md` | keep-live (2 falsified lines) | :47 "Sidebar.vue:820 still freezes `v0.1 · local`" — the string moved to `en.json:1534`; Sidebar.vue no longer has it. :50 `chapters.outline.intro` "says Outline / Cards / Read" — that copy no longer exists (`en.json:1930` is correct). The user-doc copies of the Cards bug ARE still live (below). |
| `IDEAS.md` | keep-live (2 dead links) | :196/:198 point at `docs/ai-features-roadmap.md` + `docs/potential-roadmap.md` — both moved to `docs/dev/` 2026-07-31. |
| `ARCHITECTURE.md` | **UPDATE — sections dead below the banner** | :104 RAG "per-project IndexedDB" (real: `rag/vectorStore.js` + server SQLite) · :118 "pure cosine only" (bm25 present in 4 files + `api/rag.py`) · :114 "never auto-fires" (`rag/autoIndex.js` exists) · :84-85 `stores/ai.js` usageLog/recordUsage (gone; usage reads `/v1/ai-usage`) · :106 Writer-Lab routes (absent from router) · :393 "no CI, no lint, no test runner" (release.yml + biome + 55 test files) · :414-417 wdio/Edge-version claims (wdio dropped `f345de6`; driver matches WebView2) · :6-7 links one level short (404). Where it contradicts `ai-features-roadmap.md`, **code sides with the roadmap** — fix ARCHITECTURE, not the roadmap. |
| `architecture-notes.md` | update (1 dead section) | :188-205 documents the root `just-ai-help/` folder + a runnable node command — folder deleted 2026-08-04 (`9886174`), tool retired. Rest clean. |
| `ui-kit.md` | keep | Verified clean. |
| `bench.md` | keep | Commands match package.json. |
| `ai-features-roadmap.md` | keep (history) | Code sides with it over ARCHITECTURE.md. |
| `potential-roadmap.md` | keep (history) | Own banner; links resolve. |

### docs/reference (1)

`character-template-v3.md` — keep-live; provenance accurate.

### docs/plans (56) — rollup: keep-live 8 · banner-close 16 · archive 31 · unclear 1

**Keep-live (8):** 2026-06-18-unified-storage-no-idb (cited by CLAUDE.md:62 as the
live DB ruling **but carries a ⛔-NOT-CURRENT banner** — conflict to resolve) ·
2026-07-19-llm-bench-harness (TASKS:117) · 2026-07-22-igpu-research-and-cpu-band-
recovery (TASKS ×3) · 2026-07-22-pass1-execution-plan (open tail) ·
2026-07-25-session-handoff-and-verification-debt (TASKS:25) ·
2026-07-26-editor-expansion-executor-plan (NOT LAUNCHED) ·
2026-07-26-i18n-single-source-research (TASKS:58; **needs correction, not closure**
— its "THE TOOL EXISTS — just-ai-help" sections describe the retired tool as
current) · 2026-07-26-writers-editor-gap-research (TASKS:31 + IDEAS).

**Banner-close (16):** 2026-07-02-portable-data-root ("LIVE STATUS" header, body
says COMPLETE) · 2026-07-06-onbox-profile-ab-test · 2026-07-10 ×3 (page-related-
undo, qc46-welcome, zero-project-welcome) · 2026-07-11-rag-story-bible-build ·
2026-07-12-sample-novel · 2026-07-13-rust-minimization (D2 open → fact list) ·
2026-07-19-batch-fill-from-book (live-run debt → fact list) ·
2026-07-19-provider-tabs-and-setup-landing · 2026-07-20-mtp-verify-think-ab-bench ·
2026-07-22-hardware-class-named-entity ("BUILDING" vs "Shipped" self-contradiction) ·
2026-07-25-per-band-model-survey (2 open user decisions → fact list) ·
2026-07-26-i18n-phase1-coverage-plan (merged per TASKS:32) ·
2026-06-23-feature-workbench-action-grain (stale "in progress" line) ·
2026-07-16-think-ab-and-loop-retest → moved to UNCLEAR.

**Archive (31):** the June cutover/supersede set + shipped-and-banner'd July records
(full list in the survey; includes 2026-07-14-risk-tiered-commit-gate — **shipped
then REVERSED** by TASKS "commit-gate hooks are REJECTED"; archive with a
SUPERSEDED-by-ruling note so the built-then-killed fact survives; and
2026-06-27-session-handoff — needs a banner + cites deleted MORNING_RECAP.md).

**Unclear (1, user ruling):** `2026-07-16-think-ab-and-loop-retest.md` — a
user-ordered on-box test batch (think OFF/ON A/B; b9993 loop re-test) whose RESULTS
block is an empty template. Dead work, or an owed box-check that fell out of the
tracker?

### User-docs light pass (24) — clear hits only

- `docs/README.md:36` + `docs/writing.md:82,:85,:417` — "Cards" presented as a
  top-level view mode; real control is Edit/Outline/Read with Cards as a sub-toggle
  inside Edit (`ChaptersView.vue:1067-1070`). Same drift TASKS flagged in the
  (now-fixed) i18n copy — the user-doc copies are still live.
- `docs/roadmap.md:12` — curated tag vocabulary listed as future; **shipped in June**
  (`stores/project.js:373,545`, `TagEditor.vue`), and as worded contradicts the
  recorded "no starter tag set" rejection.
- `docs/roadmap.md:27` — frames the engine-settings future on the tier system; the
  source of truth is the preset (2026-07-15 rewrite). Repoint the wording.
- `docs/getting-started.md:36` — "Narrative strands" nav label; real label "Strands".
- `docs/core-concepts.md:73` — still describes the delete-Undo toast the QC-37 toast
  law removed (recorded inside the page-related-undo plan; homeless).
- The other 20 checked clean (ports, no IDB claims, no just-ai-help refs, Focus mode
  real, all TOC slugs resolve).

### Open facts needing a home (JW)

1. Rust D2 — delete legacy `images_read`/`images_delete`: **the user's call was never
   made** (rec was delete, 2026-07-13).
2. Pass-1 execution tail — smoke's splash-aware wait (its TASKS pointer is now
   dead), the box-look list, the iGPU laptop kit queue.
3. Per-band survey — the two open user decisions (:5).
4. Batch Fill-from-book — review phase + auto-apply write never had a live run.
5. Think-A/B + loop re-test — empty RESULTS (the UNCLEAR above).
6. `core-concepts.md:73` delete-Undo toast fix (trapped in a shipped plan).
7. The no-IDB DB ruling stranded under a NOT-CURRENT banner (lift into
   ARCHITECTURE.md or exempt the file).
8. Commit-gate built-then-reversed fact (preserve on archive).
9. 2026-06-20-deep-audit backlog — never triaged into IDEAS; overlaps the open
   "extraction vs copies" audit; merge decision before archiving.

### Stale cross-references (JW)

architecture-notes :188-205 (retired tool) · IDEAS :196/:198 (moved roadmaps) ·
ARCHITECTURE :6-7 (depth) · 3 plans → deleted MORNING_RECAP.md · README ×5 groups
(renderer tree, .mjs names, openai-compat, structure, driver wording) · CLAUDE.md ×3
· i18n-single-source-research just-ai-help sections. Two intra-plan links break if
their targets archive — repath on move.

---

## 4. JustVoice (light pass, classification only)

**No live tracker in the repo at all** — `docs/dev/` holds only `design-law.md`
(keep-live). JV's open work is tracked in JW's whole-system TASKS.md; the only
in-repo pointer to that fact is a doc *named* "archive"
(`docs/plans/archive/2026-07-29-morning-recap-archive.md`).

**Three docs actively misroute a fresh reader:** `docs/plans/2026-06-16-SESSION-
HANDOFF.md` (gives first-30-minutes instructions for a June session; archive
urgently) · `docs/IMPLEMENTATION_PLAN.md` ("APPROVED (in progress)" from June 11;
`CONCEPTS.md` still routes readers to it) · `docs/plans/2026-06-20-shared-ai-stack-
plan.md` (832 lines calling itself "authoritative"; superseded by the runner's 07-06
master plan — needs a pointer banner).

**Plans rollup (35):** keep-live 6 (incl. 3 to RELOCATE: the magical-scone design
analysis → rename; the 06-18 backend decision → `docs/decisions/`; the NLP
competitor research → `docs/research/`) · banner-close 6 · archive ~21 · unclear 2
(2026-06-12-justwrite-roundtrip-slice1 — "JW side MISSING", status never written
back; 2026-06-20-deep-audit — a backlog that may still hold live items).

**Root strays:** AUDIT_old_vs_new.md, PHASE_PLAN.md, PHASE5_JUSTWRITE_INTEGRATION.md
→ archive · DESIGN_FREEZE.md (940 lines, ⏳-pending legend, touched Aug 1),
CONTRACT.md (cites deleted MORNING_RECAP.md), FEATURES.md (911-line user guide
overlapping docs/) → UNCLEAR, need the user.

**User docs:** `docs/profiles.md` is DEAD (Profiles surface killed post-Phase-1;
already out of toc.json — delete the file) · `toc.json` lists a `stories` slug with
no `docs/stories.md` (doc missing, view exists) · `docs/channels.md` still mentions
the dead "profile" concept. `docs/CONCEPTS.md` is a dev design record colliding with
`core-concepts.md` by name → relocate to `docs/dev/`.

**Code find from the port check:** `JustVioce/scripts/smoke.js:29` still targets
port 8741, which JV no longer listens on (real: 17494) — dead code or a smoke
script that cannot have worked since the re-port. Fix during JV's go.

**Misc:** `docs/decisions/discussed-features-inventory.md` is a Claude memory file
checked into the repo (archive) · `docs/gui-parity/` (40 PNGs, 5.5 MB, June ledger)
→ archive · zero just-ai-help references · ~15 dead sandbox/home paths + 3 research
docs citing the pre-move path of the magical-scone doc.

---

## Cross-repo decisions surfaced by the survey

1. **Where does JV's tracker live?** Convention says every repo gets
   `docs/dev/TASKS.md` + `IDEAS.md`; JW's tracker is charter'd whole-system.
   Recommendation: every repo gets its own pair for repo-local work (runner + JV
   created in this campaign); JW's keeps JW + genuinely cross-app coordination;
   kit/runner items move to the runner's new tracker.
2. **JV port registry correction** — the standard, docgen's CLAUDE.md, and docgen's
   lib.rs comment all say 8741; JV really listens on 17494. Decide which is canon
   (fix the docs to 17494, or re-port JV to 8741) before anything repeats it again.
3. **The three UNCLEARs needing rulings:** JW's empty-RESULTS think-A/B doc · the
   runner's big-batch-queue triage + load-cancel T-by-T · JV's roundtrip-slice1 /
   deep-audit / DESIGN_FREEZE / CONTRACT / FEATURES set.
