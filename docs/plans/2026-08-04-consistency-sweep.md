# The consistency sweep — every divergence, classified (2026-08-04)

One exhaustive pass (docgen vs JW vs kit defaults), every claim at file:line. Classes:
**B** = unjustified divergence (fix) · **A** = legitimate app voice (keep) · **C** = kit
gap forcing invention (fix upstream). Items struck ~~like this~~ were already fixed
earlier the same day (boot control, formgrid/UiProgress swaps). This file is the Family
Surface Contract's first enforcement list.

## Headline counts

48 discrete B-divergences found in 11 groups; **9 struck as fixed same-day**, ~35 open
(some are one-word fixes, some are chrome moves). 10 A-items (keep). 9 C-gaps (2 fixed:
UiProgress export; 7 open). Plus one structural finding, below.

## The structural finding

**docgen has NO i18n layer at all** — zero `vue-i18n` matches; every chrome string is a
literal in a `.vue`/`.js` file, while JW routes 100% of chrome through `en.json`. The
translation tool itself is the family's only untranslatable app. Decision needed: adopt
the JW i18n pattern here (heavy), or defer until the single-source system (JW's next big
task) mechanizes it. The nav being hardcoded (B1.5) is a symptom of this.

## B — the open fix list (condensed; full evidence in the sweep output)

**B1 nav/menu:** "AI" → **"AI Settings"** (`App.vue:24`), "Settings" → **"App
Settings"** (`App.vue:25`); no Help entry/route at all (JW has one); nav labels
hardcoded (see structural).
**B2 page headers:** hand-rolled `.page-head` H1+sub vs JW's `PaneHeader`
eyebrow+title (+`help-key`); Settings page has NO header; **zero Help affordances
app-wide** (kit exports HelpTrigger/Drawer/configureHelp; 20 JW views carry help-keys).
**B3 settings:** left rail vs JW top tabs; section set/naming (docgen "Server" vs JW's
"General"; missing Updates + Backups sections — Backups ties to the data-router
upstream item); `<h2>` vs `.card-title`; labels hardcoded vs keyed.
**B4 storage wording (same panel, different sentences):** the data-location and
disk-usage hints; "Clear" vs "Clear…"; "App logs" vs "Server logs"; "Free on disk" vs
"Free disk space"; docgen's extra "Total" row; JW's managed-row annotations missing
here; the clear-models confirm body.
**B5 wizard copy (10 real):** band scope line absent ("Sets up the built-in llama.cpp
provider only"); band sub-caption; modal eyebrow (docgen adds one, kit has none);
step titles — "Setting it up…" vs "Setting up…", "Set it up" vs "Apply setup",
"Ready to translate" vs "All set" (title pair = A-voice, buttons = B); engine bar
"llama.cpp engine" vs kit "The engine"; done-step body shape; the no-fit "Set up an
online provider" escape absent; picker placeholder.
**B6 first-run offer shape:** Home's permanent buttons vs JW's once-ever modal — the
STANDARD currently blesses both deliberately; the user rules whether the contract
tightens to one shape.
**B7 AiModelsArea props:** no `initial-provider-scope` (online deep link dead); wrapper
chrome differs (→C1). (`run-stream` absence is mitigated: the Lab's one-shot path runs
through `runAiFeature` with task registration.)
**B8 TitleBar:** tooltip wording; theme control is a cycle-button vs JW's menu (→C2).
**B9 ConnectionError:** rendered as a Home branch vs JW's mount-instead-of-app; no
`devHint` passed here.
**B10 splash residue:** ~~engine title · model title · spinner double-splash~~ (fixed —
model NAME is now the ruled shared behavior in both apps); still open: `alt=""` on the
plate vs JW's described alt text.
**B11 primitives:** ~~4+1 raw tables · both progress bars~~ (fixed); still open: the raw
`<input type="range">` accent-hue slider (`SettingsView.vue:229-233`) vs kit
`UiColorPicker` — verify the kit control actually fits a hue-only slider before ruling.

## A — legitimate voice (kept, goes through the sanctioned copy door)

Domain nav (Home/Review/Runs/Docs/Setup) · wizard titles "Local translation AI" /
"Ready to translate" · model roles ("translates your strings…") · catalogCopy set ·
Reviewer section · About tagline · domain toasts/buttons · `embeddings:false`.

## C — kit gaps (the contract closes these upstream)

**C1** no page-header component (both apps invented one — JW `PaneHeader`, docgen
`.page-head`) · **C2** no TitleBar component (both hand-rolled) · **C3** no settings
shell (JW top tabs vs docgen rail — the chrome itself should be kit) · ~~C4 UiProgress
unexported~~ (fixed) · **C5** `usePoll` unexported (docgen hand-rolls `setInterval` ×2)
· **C6** QuickSetup strings hardcoded — no copy seam, which is WHY the fork exists ·
**C7** DownloadBar buttons hardcoded (Cancel/Retry/Dismiss/Ready ✓ — sit untranslated
under JW's keyed titles) · **C8** ConnectionError strings hardcoded · **C9**
AiModelsArea tab labels hardcoded (only the 5th is host-supplied) · **C10** dialog-verb
vocabulary exists (`configureDialog`) and NEITHER app uses it — literals per call site.

## FINAL converged shape (third pass, 2026-08-04 — the four honest adjustments)

1. **The wizard fork SHRINKS, it doesn't die.** Two things in it are genuinely this
   app's: the translate/confirm preset-follow on apply, and nothing else. So: the kit
   wizard gains a copy seam (catalogCopy-style) + the family cache-offer STEP (its
   server half — the family cache registry — is ALREADY shared) + an `onApplied` hook;
   the 359-line fork view dies and a thin app hook writes the presets. B5 vanishes
   structurally.
2. **Help is a content problem, not a mount.** This app has NO per-surface help text —
   mounting the drawer empty would be a lie. PaneHeader lands here with `help-key`
   optional and unused; the Help content pass is a named separate task.
3. **The contract test adds NO new infra.** docgen has no vitest — the static scans run
   as a zero-dep `node:test` file beside the e2e suite, the rendered assertions fold
   into the existing smoke; JW gets the vitest twin over the same manifest. Both
   verified-to-bite before they count.
4. **SettingsShell is only real if JW adopts it too** — otherwise it's a third shell.
   JW's swap is its own gated step (vitest + build + its box QC).

**Five decisions needed from the user (plain questions, answer once):**
1. **Where do the headless-URL and access-token settings live, and what is the section
   called?** This app has a Settings section named "Server"; JW keeps the same controls
   inside its "General" section. Recommendation: both apps use a section named
   **Server**.
2. **Storage wording — whose words win where they differ?** Mostly JW's sentences
   become the canon ("Server logs" not "App logs", "Free disk space" not "Free on
   disk", "Clear…" with the ellipsis). One place this app is better: its disk-usage
   list has a **Total** row JW lacks. Recommendation: JW's words everywhere, PLUS both
   apps gain the Total row.
3. **How is "set up AI" first offered?** This app: two permanent buttons on the Home
   welcome ("Open Setup" / "Set up local AI") that never go away. JW: a one-time popup
   ("Set up AI features" — Quick Setup / online provider / Skip for now) shown once
   ever, remembered. The standard currently allows both on purpose. Recommendation:
   every app uses **JW's one-time popup**, and the standard stops allowing two shapes.
4. **Does this app get a translation layer for its own UI text now or later?** Its
   interface is currently English-only literals — the only untranslatable app in the
   family. Recommendation: **later** — after the single-source translation system is
   built, since that system exists to mechanize exactly this.
5. **What is the engine's progress bar titled during setup?** Kit says "The engine";
   this app's wizard says "llama.cpp engine". Recommendation: **"The engine"** — the
   technical name already appears in the description line beneath it.

## Resumption notes — the QuickSetup surgery (next chunk, go already given)

The kit wizard (`ui/src/views/QuickSetup.vue`, ~860 lines) already does non-clobber
preset-follow on apply (header comment :15-19), so the fork's ONLY unique pieces move
up and the fork dies:
1. **Copy seam:** a `quickSetupCopy` config (catalogCopy precedent — store in a small
   kit service, set via `installLlmUi`), defaults FROM `FAMILY_LABELS.quickSetup` +
   voice slots (band caption · modal/step titles · model bar role · done body).
   docgen's voice values live in its fork today (`QuickSetupI18n.vue` :254-341).
2. **Family cache-offer step:** port fork :86-139 (state/options/apply) + :279-295
   (the confirm-step UI) into the kit wizard's confirm step — server half is already
   shared (`/v1/ai/engine-cache`, the family registry).
3. **Capabilities gate:** the wizard's embedding flow hides when
   `llmUiCapabilities().embeddings === false` (same gate fixes the Set-as-default
   embeddings note at `AiModelsArea.vue:573`, queued in TASKS).
4. **`onApplied` hook** via the same config service (docgen currently needs nothing in
   it — `setAsDefault` covers presets — keep the seam for future apps).
5. Then: docgen drops the `:wizard` prop (AiView.vue:46-47), DELETES
   `QuickSetupI18n.vue`, passes its copy in `main.js`'s installLlmUi; canon words
   apply ("Apply setup" · "The engine" — already in the manifest); e2e wizard tests
   (smoke :84-186 runs the REAL wizard — re-check its assertions against the kit
   wizard's flow, esp. the routing write + restore and the modal title copy).

Also queued after it: once-ever offer (lift JW `AiSetupDialog.vue` → kit, manifest
copy; docgen drops Home's permanent "Set up local AI" button, persists the once-flag
in its ui store) · TitleBar frame lift · `usePoll` export (+ docgen `HomeView.vue`
:36-38 and `stores/jobs.js` :126-129 setInterval swaps) · JW adopts SettingsShell +
gains Server section + Total row (its SettingsView :57-66 sections; scoped CSS
:1994-1999 becomes the kit's) · `app-structure.md` §11 points at the contract.

## The fix shape (the Family Surface Contract, three tiers)

1. **Manifest in the kit** (`familyContract.js`): canonical labels + shapes; kit
   components read their own defaults from it (closes C6-C9 as a side effect: the
   strings move into the manifest with a copy-override door).
2. **Contract test in every app's suite**: shared-subset labels match the manifest;
   banned-pattern scan (raw tables/progress/rail-settings). Drift = red CI.
3. **One voice door**: A-items live in the sanctioned copy objects only.
   Kit components to land while closing C1-C3: PaneHeader, SettingsShell (top tabs,
   sections as data), TitleBar (slots for app extras).
