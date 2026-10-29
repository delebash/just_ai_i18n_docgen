<script setup>
// SPDX-License-Identifier: MIT
// Settings — JW's section pattern (/settings/:section?). Every panel names its
// donor (the 2026-08-03 rule): Storage = the kit's StoragePanel (this page's own panel, promoted
// to the kit 2026-10-19 — the old copies a move leaves, removed from here), the shell's folder
// calls; Appearance = the kit AppearancePanel
// (JV's donor rows, ONE shared surface — the 2026-08-04 shared-panel ruling);
// Server = the kit's ServerPanel (JW's headless/auth cards, promoted) over this app's /v1/server-auth;
// Logs = kit LogsPanel; About = the kit's AboutPanel (version and data folder from /v1/health);
// Reviewer = this app's own (tool-level, moved from Setup).
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  AboutPanel, AppearancePanel, DataManagement, LanguagePicker, LogsPanel, PaneHeader, ServerPanel, SettingsShell,
  StoragePanel, UiInput, UpdatesPanel,
  SETTINGS_SECTION_ORDER, pushToast, renderHelpMarkdown,
  safeRequest,
} from "@delebash/ui";
import { LOCALE_CODES } from "../i18n/index.js";
import { loadDoc } from "../services/helpDocs.js";
import {
  desktopUpdater, pickDirectory, setKeepRunning as nativeSetKeepRunning, shellVersion, storageForgetOldCopy, storageGetRoot,
  storageOldCopies, storageRelocate, storageRemoveOldCopy, storageUseDefault,
} from "../services/native.js";
import { SETTINGS_SECTION_IDS } from "../services/settingsSections.js";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
import { pageFlow } from "@delebash/ui";

const props = defineProps({ section: { type: String, default: "" } });
const router = useRouter();
const ui = useUiStore();
const project = useProjectStore();

// Shared-concept sections take their words from the FAMILY CONTRACT, in the
// canon's fixed relative order (… Appearance · Backups · Storage · Server ·
// Logs · Updates · About — parity batch 2026-08-06); Reviewer is this app's
// own (tool identity — no family equivalent) and interleaves before About.
// The ORDER lives in settingsSections.js so the canon contract test asserts
// exactly what renders (slice 11).
// The family's shared sections take the kit's words (`kit.settingsSections.*`); Reviewer is this app's.
const { t } = useI18n();
const FAMILY_SECTIONS = new Set(SETTINGS_SECTION_ORDER);
const SECTIONS = computed(() => SETTINGS_SECTION_IDS.map((id) => ({
  id,
  label: FAMILY_SECTIONS.has(id) ? t(`kit.settingsSections.${id}`) : t("settings.reviewer.title"),
})));
const active = ref(props.section || "appearance");
watch(() => props.section, (s) => { if (s) active.value = s; });

// Updates — release notes for the kit UpdatesPanel (JW's pattern: source +
// renderer app-side, presentation shared). Loaded lazily on first open. The version is the
// server's (GET /v1/health — one number, package.json), never written here.
const SOURCE_URL = "https://github.com/delebash/just_ai_i18n_docgen";
// About: the desktop runtime (Electron's version; "" in a browser). Server: the command that starts
// the server alone — the installed launcher's name.
const runtime = shellVersion();
const SERVER_COMMAND = "just-ai-i18n-docgen-server serve";
// The desktop app's updater (the kit shell's); docgen's shell has updates off until it has releases.
const updater = desktopUpdater();
const changelogHtml = ref("");
watch(active, async (a) => {
  if (a === "updates" && !changelogHtml.value) {
    changelogHtml.value = renderHelpMarkdown((await loadDoc("whats-new")) || "");
  }
});
function go(id) {
  active.value = id;
  router.replace(`/settings/${id}`);
}

// ── storage: the kit's StoragePanel over the shell's folder calls (each answers null outside the
// desktop app), as the template wires it; the data folder from the server (GET /v1/health) ──────
const health = ref(null);
const storageShell = {
  getRoot: storageGetRoot,
  pickDirectory,
  relocate: storageRelocate,
  oldCopies: storageOldCopies,
  removeOldCopy: storageRemoveOldCopy,
  forgetOldCopy: storageForgetOldCopy,
  useDefault: storageUseDefault,
};

// ── reviewer: saved on blur/Enter, never per keystroke (audit 2026-08-05) ──
const reviewerDraft = ref("");
watch(() => project.reviewer, (v) => { reviewerDraft.value = v || ""; },
      { immediate: true });
async function saveReviewer() {
  if ((reviewerDraft.value || "").trim() === (project.reviewer || "")) return;
  try {
    await project.setReviewer(reviewerDraft.value.trim());
    pushToast({ kind: "success", title: t("settings.reviewer.saved") });
  } catch (e) {
    pushToast({ kind: "error", title: t("common.couldNotSave"), description: String(e?.message || e) });
  }
}

// The keep-running toggle writes the shell's flag immediately AND persists in the
// ui store (layouts/MainLayout.vue re-applies it every boot — the shell's flag resets per launch).
async function setKeepRunning(v) {
  ui.setKeepServerRunning(!!v);
  // services/native.js — no-op in browser dev; the store still remembers.
  await nativeSetKeepRunning(v);
}

onMounted(async () => {
  const [h] = await Promise.all([safeRequest("/v1/health", null), project.refresh()]);
  health.value = h;
});
</script>

<template>
  <q-page :style-fn="pageFlow" class="settings">
    <!-- The family Settings chrome: PaneHeader + the kit's top-tab shell (the rail
         this page invented died in the 2026-08-04 consistency pass). -->
    <PaneHeader :eyebrow="t('settings.eyebrow')" :title="t('settings.title')" help-key="settings" />
    <SettingsShell :sections="SECTIONS" :model-value="active" @update:model-value="go">
      <!-- Appearance — the kit AppearancePanel (JV's donor rows, one shared surface) -->
      <template v-if="active === 'appearance'">
        <section class="card">
          <h2>{{ t("kit.settingsSections.appearance") }}</h2>
          <p class="hint">{{ t("settings.appearanceHint") }}</p>
          <AppearancePanel
            :appearance="ui.appearance"
            :accent-chroma="0.12"
            :accent-note="t('settings.accentNote')"
            @patch="(p) => ui.setAppearance(p)"
          />
        </section>
        <!-- The language — the kit's LanguagePicker in its own card, as JustWrite shows it (the
             AppearancePanel's own Language row waits for JustVoice's languages to be codes). -->
        <section class="card">
          <h2>{{ t("kit.settings.language.label") }}</h2>
          <LanguagePicker :locales="LOCALE_CODES" @change="(code) => ui.setLocale(code)" />
        </section>
      </template>

      <!-- Backups — the family surface (kit DataManagement over the shared
           /v1/data router, mounted server-side this batch). No app options:
           this tool's per-project text lives in YOUR project next to its
           config, never under the data dir — the backup is the app database. -->
      <template v-else-if="active === 'backups'">
        <section class="card">
          <h2>{{ t("kit.settingsSections.backups") }}</h2>
          <p class="hint">{{ t("settings.backupsHint") }}</p>
          <DataManagement app-name="just-ai-i18n-docgen" />
        </section>
      </template>

      <!-- Storage — the kit's StoragePanel: the data folder, Change folder…, the old copies a move
           leaves (Remove the old copy), the disk usage and what can be cleared -->
      <StoragePanel v-else-if="active === 'storage'" :data-dir="health?.dataDir || ''" :shell="storageShell" :saves="t('settings.storage.saves')" />

      <!-- Server — the kit's ServerPanel: the headless address, keep-running (the ui store keeps it and
           tells the shell — the family headless/tray ruling, 2026-08-04), the access tokens -->
      <ServerPanel v-else-if="active === 'server'" :server-command="SERVER_COMMAND" :keep-running="ui.keepServerRunning" @update:keep-running="setKeepRunning" />

      <!-- Logs -->
      <template v-else-if="active === 'logs'">
        <section class="card settings__logs">
          <h2>{{ t("kit.storage.serverLogs") }}</h2>
          <p class="hint">{{ t("settings.logsHint") }}</p>
          <LogsPanel />
        </section>
      </template>

      <!-- Reviewer -->
      <!-- Updates — the kit UpdatesPanel (release notes from docs/whats-new.md;
           no auto-updater in this app yet, so the #actions slot stays empty). -->
      <template v-else-if="active === 'updates'">
        <section class="card">
          <UpdatesPanel :app-version="health?.version || ''" :changelog-html="changelogHtml" :updater="updater" />
        </section>
      </template>

      <template v-else-if="active === 'reviewer'">
        <section class="card">
          <h2>{{ t("settings.reviewer.title") }}</h2>
          <p class="hint">{{ t("settings.reviewer.hint") }}</p>
          <!-- Saved on blur/Enter, never per keystroke — typing "dana" used to PUT
               four times, and a mid-word snapshot could stamp an acceptance
               (audit 2026-08-05). -->
          <UiInput
            v-model="reviewerDraft" width="name" :placeholder="t('settings.reviewer.placeholder')"
            @blur="saveReviewer" @keydown.enter="saveReviewer"
          />
        </section>
      </template>

      <!-- About — the kit's AboutPanel with this app's words, version, runtime, data folder and source -->
      <AboutPanel
        v-else :app-name="t('app.name')" :blurb="t('settings.about.blurb')" :version="health?.version || ''"
        :runtime="runtime" :data-dir="health?.dataDir || ''" :source-url="SOURCE_URL"
      />
    </SettingsShell>
  </q-page>
</template>
