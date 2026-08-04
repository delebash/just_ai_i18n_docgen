# Kit-reuse audit — 2026-08-04

Trigger: the user spotted the boot splash printing the loading MODEL NAME (JW shows a static
sentence) and a double-splash boot, and asked how much of this app is hand-rolled vs. reusing
the shared kit (`@delebash/llm-ui` → `../just-llm-runner/ui/src`, alias verified in both
consumers' vite configs). Every claim below was verified at file:line by a read-only sweep of
this app's whole `src/`, the kit's exports, and JW as the reference consumer.

## 1. The model name on the splash — a prop divergence, not a hand-rolled component

Both apps render the load bar with the kit's `DownloadBar`. The difference is one prop:

| | this app (`src/App.vue`) | JW (`justwrite-app/src/App.vue`) |
|---|---|---|
| Model-phase title | `:title="warmModelId"` (App.vue:138) — the raw model ID from `warmStartup.js:28-31` | `:title="$t('boot.loadingModel')"` = "Loading your writing model" (App.vue:189) |
| Engine-phase title | `title="llama.cpp engine"` hard-coded (App.vue:137) | `$t('boot.settingUpEngine')` (App.vue:188) |

Our `App.vue:129-132` even cites JW's block as its donor — the divergence crept in during the
transcription. Everything else in the splash block (700 ms auto-dismiss, `warmRowStatus`,
dismiss handlers) matches JW line-for-line.

**Open ruling (user):** the user LIKES the model name. Shared-stack consistency allows two
fixes: (a) match JW's static string here, or (b) upstream the model-name title into the shared
pattern so BOTH apps show it. One decision, applied to both.

## 2. The double splash — confirmed; actually three surfaces

This app: `index.html:37-41` shows a static CSS **spinner** + app name → `main.js:43` mounts
Vue immediately, `warmModelId` is still `""`, so the **bare shell flashes** → after
`project.refresh()` + two more round trips (`App.vue:66-72`, `warmStartup.js:22-30`)
`warmModelId` fills and the **plate splash** finally mounts. Spinner → shell → plate.

JW: `index.html:38-40` IS the plate image, and `main.js:199` runs `startWarmOnBoot()`
**before** `app.mount()` (the comment at `main.js:194-198` states this intent), so Vue's
plate replaces the identical static plate pixel-for-pixel. One continuous image.

**Fix = JW's two mechanics:** put the plate in `index.html` (drop the spinner), and move
`startWarmOnBoot()` pre-mount. Also align `object-fit` (ours `cover`, JW `fill`) and the
static background colour. Bonus: `src/assets/images/just ai i18n docgen splash.png` (1.81 MB)
is referenced by nothing — delete or use.

## 3. Hand-rolled sites where an exported kit component exists (6)

| Local | Kit counterpart |
|---|---|
| `SettingsView.vue:246,302,314,366` — four raw `<table class="plain">` | `UiTable` (JW's SettingsView has zero raw tables) |
| `SetupView.vue:107` — fifth raw table | `UiTable` |
| `ReviewView.vue:199,235` — raw `<textarea class="detail-text">` ×2 | `UiTextarea` |
| `ReviewView.vue:171-178` — hand-rolled `.flagchip` spans | `UiChip`/`UiTag` (UiTag is already used elsewhere in this app) |
| `ReviewView.vue:180-190,256-273` — hand-rolled empty states | `EmptyState` |
| `styles.css:54-62` `.iconbtn` (TitleBar ×3, HomeView ×1) | ghost `UiButton` |

## 4. Not counted as failures

- **`QuickSetupI18n.vue`** — a re-implementation of the kit wizard, but through the kit's own
  `wizard` seam (`AiModelsArea.vue:74-79`; `useCatalogMeta` exported for exactly this), and it
  adds the app-only shared-AI-cache offer. Sanctioned; JW mounts the kit wizard unmodified.
- **`RunsView.vue:81` + `HomeView.vue:196-197` progress bars** — the kit HAS `UiProgress` but
  does NOT export it (`index.js`/`common/index.js`; kit-internal only). Hand-rolling was
  forced. Real fix: export `UiProgress` from the kit, then use it in both places (we currently
  have two differently-styled local progress controls in one app).

## 5. What is correctly reused (the big surfaces are kit)

`installLlmUi` one-call boot (`main.js:4`), `AiModelsArea` + wizard seam (`AiView.vue`),
`AiStatusButton` in the TitleBar (same as JW), `DownloadBar`, `LlmUiHosts`, `LogsPanel`,
`AiTaskStrip`, `ConnectionError`, kit primitives (`UiButton/Input/Select/Toggle/Checkbox/
MultiSelect/Table/Tag`) across Home/Runs/Settings/Setup, kit transport (`get/post/put/del/
safeRequest/serverUrl`) in every store, kit appearance engine, `useAiTasksStore` integration.
TitleBar and `warmStartup.js`/`appearance.js` are local by family pattern — JW keeps its own
too; the kit has no TitleBar.
