<script setup>
// SPDX-License-Identifier: MIT
// Settings — JW's section pattern (/settings/:section?). Every panel names its
// donor (the 2026-08-03 rule): Storage = JW's Data location + Disk usage panels,
// strings verbatim (app name swapped); Appearance = the kit AppearancePanel
// (JV's donor rows, ONE shared surface — the 2026-08-04 shared-panel ruling);
// Server = JW's headless/auth section over this app's /v1/server-auth;
// Logs = kit LogsPanel; Reviewer = this app's own (tool-level, moved from Setup).
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  AppearancePanel, DataManagement, LanguagePicker, LogsPanel, PaneHeader, SettingsShell,
  UiButton, UiInput, UiToggle, UpdatesPanel, confirmDialog, fmtBytes, get,
  SETTINGS_SECTION_ORDER, openExternal, post, pushToast, put, refreshRunnerModels, renderHelpMarkdown,
  safeRequest, serverUrl,
} from "@delebash/ui";
import { LOCALE_CODES } from "../i18n/index.js";
import { loadDoc } from "../services/helpDocs.js";
import { desktopUpdater, pickDirectory, storageGetRoot, storageRelocate, setKeepRunning as nativeSetKeepRunning } from "../services/native.js";
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
// renderer app-side, presentation shared). Loaded lazily on first open.
const APP_VERSION = "0.1.0";
const SOURCE_URL = "https://github.com/delebash/just_ai_i18n_docgen";
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

// ── storage (JW's panels) ─────────────────────────────────────────────────
const storageRoot = ref(null); // { root, default, portable } from the shell
const isDesktop = ref(false);
const relocating = ref(false);
const storageErr = ref("");
const diskUsage = ref(null);
const diskBusy = ref("");
const diskErr = ref("");

async function loadStorageRoot() {
  // services/native.js — the one place a command name is written.
  storageRoot.value = await storageGetRoot();
  isDesktop.value = !!storageRoot.value;
}
async function loadDiskUsage() {
  diskUsage.value = await safeRequest("/v1/disk/usage", null);
}
// Loading state = an em-dash per row; a real 0 formats as "0 MB" (the kit's
// fmtBytes returns "" for 0). fmtBytes stays the ONE source for the number.
function diskSize(n) {
  if (diskUsage.value == null) return "—";
  return fmtBytes(n) || "0 MB";
}
async function changeFolder() {
  storageErr.value = "";
  const picked = await pickDirectory({
    title: t("settings.storage.chooseFolder"), defaultPath: storageRoot.value?.root || "",
  });
  if (!picked) return;
  const yes = await confirmDialog({
    title: t("settings.storage.moveTitle"),
    message: t("settings.storage.moveMessage", { folder: picked }),
    confirmLabel: t("settings.storage.moveConfirm"),
  });
  if (!yes) return;
  relocating.value = true;
  try {
    await storageRelocate(picked);
    window.location.reload();
  } catch (e) {
    storageErr.value = String(e || t("settings.storage.moveFailed"));
    relocating.value = false;
  }
}
async function clearModelsCache() {
  const size = fmtBytes(diskUsage.value?.modelsCache) || "0 MB";
  const yes = await confirmDialog({
    title: t("settings.storage.clearModelsTitle"),
    message: t("settings.storage.clearModelsMessage", { size }),
    confirmLabel: t("settings.storage.clearModelsConfirm"),
  });
  if (!yes) return;
  diskBusy.value = "models";
  diskErr.value = "";
  try {
    const res = await post("/v1/llm-runner/models-cache/clear");
    if (res?.ok === false) {
      diskErr.value = res.detail === "unload models first"
        ? t("settings.storage.unloadFirst")
        : res.detail || t("settings.storage.clearModelsFailed");
    }
  } catch {
    diskErr.value = t("settings.storage.clearModelsFailed");
  } finally {
    diskBusy.value = "";
    await loadDiskUsage();
    // Re-stat the shared catalog so cleared models flip to "Download" (JW's rule).
    refreshRunnerModels();
  }
}
async function clearSpawnLogs() {
  diskBusy.value = "spawn";
  diskErr.value = "";
  try {
    await post("/v1/llm-runner/spawn-logs/clear");
  } catch {
    diskErr.value = t("settings.storage.clearLogsFailed");
  } finally {
    diskBusy.value = "";
    await loadDiskUsage();
  }
}

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

// ── server (headless access + bearer tokens — JW's section) ───────────────
const auth = ref({ tokens: [], requireForLoopback: false });
const tokenDraft = ref("");
const headlessUrl = computed(
  () => serverUrl("") || (typeof window !== "undefined" ? window.location.origin : ""),
);
async function loadAuth() {
  const a = await safeRequest("/v1/server-auth", null);
  if (a) auth.value = a;
}
async function saveAuth(patch) {
  const next = { ...auth.value, ...patch };
  try {
    auth.value = await put("/v1/server-auth", next);
  } catch (e) {
    pushToast({ kind: "error", title: t("common.couldNotSave"), description: String(e?.message || e) });
  }
}
function addToken() {
  const token = tokenDraft.value.trim();
  if (!token) return;
  tokenDraft.value = "";
  saveAuth({ tokens: [...auth.value.tokens, token] });
}
function dropToken(token) {
  saveAuth({ tokens: auth.value.tokens.filter((x) => x !== token) });
}

// The keep-running toggle writes the shell's flag immediately AND persists in the
// ui store (layouts/MainLayout.vue re-applies it every boot — the shell's flag resets per launch).
async function setKeepRunning(v) {
  ui.setKeepServerRunning(!!v);
  // services/native.js — no-op in browser dev; the store still remembers.
  await nativeSetKeepRunning(v);
}

onMounted(async () => {
  await Promise.all([project.refresh(), loadStorageRoot(), loadDiskUsage(), loadAuth()]);
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

      <!-- Storage — JW's Data location + Disk usage, strings verbatim -->
      <template v-else-if="active === 'storage'">
        <section class="card">
          <h2>{{ t("settings.storage.locationTitle") }}</h2>
          <p class="hint">{{ t("settings.storage.locationHint") }}</p>
          <table class="ui-formgrid">
            <tbody>
              <tr>
                <th>{{ t("settings.storage.folder") }}</th>
                <td class="mono">{{ isDesktop ? (storageRoot?.root || "—") : t("settings.storage.headlessFolder") }}</td>
              </tr>
              <tr v-if="isDesktop">
                <th>{{ t("settings.storage.type") }}</th>
                <td>{{ storageRoot?.portable ? t("settings.storage.portable") : t("settings.storage.userFolder") }}</td>
              </tr>
            </tbody>
          </table>
          <div class="row" style="margin-top: 12px" v-if="isDesktop">
            <UiButton
              intent="secondary" :label="relocating ? t('settings.storage.moving') : t('settings.storage.changeFolder')"
              :disabled="relocating" @click="changeFolder"
            />
          </div>
          <p v-else class="hint" style="margin: 8px 0 0">{{ t("settings.storage.desktopOnly") }}</p>
          <p v-if="storageErr" class="mono setup__error">{{ storageErr }}</p>
        </section>

        <section class="card">
          <h2>{{ t("settings.storage.diskTitle") }}</h2>
          <p class="hint">{{ t("settings.storage.diskHint") }}</p>
          <div class="diskgrid">
            <span class="muted">{{ t("settings.storage.modelsCache") }}</span>
            <div class="row">
              <span>{{ diskSize(diskUsage?.modelsCache) }}</span>
              <UiButton intent="secondary" size="small" :disabled="!!diskBusy"
                        :label="diskBusy === 'models' ? t('common.clearing') : t('kit.storage.clearShort')" @click="clearModelsCache" />
            </div>
            <span class="muted">{{ t("settings.storage.spawnLogs") }}</span>
            <div class="row">
              <span>{{ diskSize(diskUsage?.spawnLogs) }}</span>
              <UiButton intent="secondary" size="small" :disabled="!!diskBusy"
                        :label="diskBusy === 'spawn' ? t('common.clearing') : t('kit.storage.clearShort')" @click="clearSpawnLogs" />
            </div>
            <span class="muted">{{ t("settings.storage.engineBuilds") }}</span><span>{{ diskSize(diskUsage?.engineBuilds) }}</span>
            <span class="muted">{{ t("settings.storage.database") }}</span><span>{{ diskSize(diskUsage?.database) }}</span>
            <span class="muted">{{ t("kit.storage.serverLogs") }}</span><span>{{ diskSize(diskUsage?.appLogs) }}</span>
            <span class="muted"><b>{{ t("kit.storage.total") }}</b></span><span><b>{{ diskSize(diskUsage?.total) }}</b></span>
            <span class="muted">{{ t("kit.storage.freeSpace") }}</span><span>{{ diskSize(diskUsage?.diskFree) }}</span>
          </div>
          <p v-if="diskErr" class="mono setup__error">{{ diskErr }}</p>
        </section>
      </template>

      <!-- Server — headless access + bearer tokens (JW's section) -->
      <template v-else-if="active === 'server'">
        <section class="card">
          <h2>{{ t("settings.server.headlessTitle") }}</h2>
          <i18n-t keypath="settings.server.headlessHint" tag="p" class="hint" scope="global">
            <template #command><code class="mono">just-ai-i18n-docgen-server serve</code></template>
          </i18n-t>
          <table class="ui-formgrid">
            <tbody>
              <tr><th>{{ t("settings.server.url") }}</th><td class="mono">{{ headlessUrl }}</td></tr>
            </tbody>
          </table>
          <!-- The family headless/tray ruling (2026-08-04, JV's donor): OFF ⇒
               closing the window stops everything; ON ⇒ the window closes but the
               tray + server stay. -->
          <label class="row" style="gap: 10px; margin-top: 12px; align-items: center">
            <UiToggle
              :model-value="ui.keepServerRunning"
              @update:model-value="setKeepRunning"
            />
            <span>{{ t("settings.server.keepRunning") }}</span>
          </label>
          <p class="hint" style="margin-top: 4px">{{ t("settings.server.keepRunningHint") }}</p>
        </section>
        <section class="card">
          <h2>{{ t("settings.server.tokensTitle") }}</h2>
          <!-- The donor's words (JW settings.server) — "loopback" was invented at
               port time; JW's user-facing label says localhost (audit 2026-08-05). -->
          <i18n-t keypath="settings.server.tokensHint" tag="p" class="hint" scope="global">
            <template #header><code class="mono">Authorization: Bearer</code></template>
            <template #api><code class="mono">/v1</code></template>
          </i18n-t>
          <table class="ui-formgrid" v-if="auth.tokens.length">
            <tbody>
              <tr v-for="token in auth.tokens" :key="token">
                <td class="mono">{{ token }}</td>
                <td style="width: 90px">
                  <UiButton intent="ghost" size="small" :label="t('kit.common.remove')" @click="dropToken(token)" />
                </td>
              </tr>
            </tbody>
          </table>
          <div class="row" style="margin-top: 10px">
            <UiInput v-model="tokenDraft" width="name" :placeholder="t('settings.server.tokenPlaceholder')" @keydown.enter="addToken" />
            <UiButton intent="secondary" :label="t('settings.server.addToken')" :disabled="!tokenDraft.trim()" @click="addToken" />
          </div>
          <div class="row" style="margin-top: 12px">
            <UiToggle
              :model-value="auth.requireForLoopback" :label="t('settings.server.requireOnLocalhost')"
              @update:model-value="(v) => saveAuth({ requireForLoopback: v })"
            />
          </div>
        </section>
      </template>

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
          <UpdatesPanel :app-version="APP_VERSION" :changelog-html="changelogHtml" :updater="updater" />
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

      <!-- About -->
      <template v-else>
        <section class="card">
          <h2>{{ t("app.name") }}</h2>
          <p class="hint">{{ t("settings.about.blurb") }}</p>
          <table class="ui-formgrid">
            <tbody>
              <tr><th>{{ t("settings.about.version") }}</th><td class="mono">{{ APP_VERSION }}</td></tr>
              <tr>
                <th>{{ t("settings.about.source") }}</th>
                <td><a :href="SOURCE_URL" @click.prevent="openExternal(SOURCE_URL)">{{ SOURCE_URL.replace("https://", "") }}</a></td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </SettingsShell>
  </q-page>
</template>
