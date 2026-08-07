<script setup>
// SPDX-License-Identifier: MIT
// Settings — JW's section pattern (/settings/:section?). Every panel names its
// donor (the 2026-08-03 rule): Storage = JW's Data location + Disk usage panels,
// strings verbatim (app name swapped); Appearance = the kit AppearancePanel
// (JV's donor rows, ONE shared surface — the 2026-08-04 shared-panel ruling);
// Server = JW's headless/auth section over this app's /v1/server-auth;
// Logs = kit LogsPanel; Reviewer = this app's own (tool-level, moved from Setup).
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  AppearancePanel, DataManagement, FAMILY_LABELS, LogsPanel, PaneHeader, SettingsShell,
  UiButton, UiInput, UiToggle, UpdatesPanel, confirmDialog, fmtBytes, get,
  openExternal, post, pushToast, put, refreshRunnerModels, renderHelpMarkdown,
  safeRequest, serverUrl,
} from "@delebash/llm-ui";
import { loadDoc } from "../services/helpDocs.js";
import { SETTINGS_SECTION_IDS } from "./settingsSections.js";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

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
const SECTIONS = SETTINGS_SECTION_IDS.map((id) => ({
  id,
  label: FAMILY_LABELS.settingsSections[id] || "Reviewer",
}));
const active = ref(props.section || "appearance");
watch(() => props.section, (s) => { if (s) active.value = s; });

// Updates — release notes for the kit UpdatesPanel (JW's pattern: source +
// renderer app-side, presentation shared). Loaded lazily on first open.
const APP_VERSION = "0.1.0";
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
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    storageRoot.value = await invoke("storage_get_root");
    isDesktop.value = true;
  } catch {
    isDesktop.value = false;
  }
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
  const { invoke } = await import("@tauri-apps/api/core");
  const picked = await invoke("pick_directory", {
    title: "Choose a data folder", defaultPath: storageRoot.value?.root || "",
  });
  if (!picked) return;
  const yes = await confirmDialog({
    title: "Move all app data?",
    message: `Everything this tool saves — connections, presets, the AI engine and models, and logs — moves to ${picked}. The app restarts when the move finishes.`,
    confirmLabel: "Move & restart",
  });
  if (!yes) return;
  relocating.value = true;
  try {
    await invoke("storage_relocate", { newRoot: picked });
    window.location.reload();
  } catch (e) {
    storageErr.value = String(e || "Move failed.");
    relocating.value = false;
  }
}
async function clearModelsCache() {
  const size = fmtBytes(diskUsage.value?.modelsCache) || "0 MB";
  const yes = await confirmDialog({
    title: "Clear downloaded models?",
    message: `This frees ${size} of downloaded model files. Your models stay in the catalog and re-download on demand.`,
    confirmLabel: "Clear models cache",
  });
  if (!yes) return;
  diskBusy.value = "models";
  diskErr.value = "";
  try {
    const res = await post("/v1/llm-runner/models-cache/clear");
    if (res?.ok === false) {
      diskErr.value = res.detail === "unload models first"
        ? "A model is loaded — unload it first (AI page → Unload), then try again."
        : res.detail || "Couldn't clear the models cache.";
    }
  } catch {
    diskErr.value = "Couldn't clear the models cache.";
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
    diskErr.value = "Couldn't clear the engine logs.";
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
    pushToast({ kind: "success", title: "Reviewer saved" });
  } catch (e) {
    pushToast({ kind: "error", title: "Could not save", description: String(e?.message || e) });
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
    pushToast({ kind: "error", title: "Could not save", description: String(e?.message || e) });
  }
}
function addToken() {
  const t = tokenDraft.value.trim();
  if (!t) return;
  tokenDraft.value = "";
  saveAuth({ tokens: [...auth.value.tokens, t] });
}
function dropToken(t) {
  saveAuth({ tokens: auth.value.tokens.filter((x) => x !== t) });
}

// The keep-running toggle writes the shell's flag immediately AND persists in the
// ui store (App.vue re-applies it every boot — the Rust flag resets per launch).
async function setKeepRunning(v) {
  ui.setKeepServerRunning(!!v);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_keep_server_running", { keepRunning: !!v });
  } catch { /* browser dev — no shell; the store still remembers */ }
}

onMounted(async () => {
  await Promise.all([project.refresh(), loadStorageRoot(), loadDiskUsage(), loadAuth()]);
});
</script>

<template>
  <div class="settings">
    <!-- The family Settings chrome: PaneHeader + the kit's top-tab shell (the rail
         this page invented died in the 2026-08-04 consistency pass). -->
    <PaneHeader eyebrow="App" title="Settings" help-key="settings" />
    <SettingsShell :sections="SECTIONS" :model-value="active" @update:model-value="go">
      <!-- Appearance — the kit AppearancePanel (JV's donor rows, one shared surface) -->
      <template v-if="active === 'appearance'">
        <section class="card">
          <h2>Appearance</h2>
          <p class="hint">Visual preferences, applied immediately and saved on this machine.</p>
          <AppearancePanel
            :appearance="ui.appearance"
            :accent-chroma="0.12"
            accent-note="Default 277° = indigo."
            @patch="(p) => ui.setAppearance(p)"
          />
        </section>
      </template>

      <!-- Backups — the family surface (kit DataManagement over the shared
           /v1/data router, mounted server-side this batch). No app options:
           this tool's per-project text lives in YOUR project next to its
           config, never under the data dir — the backup is the app database. -->
      <template v-else-if="active === 'backups'">
        <section class="card">
          <h2>{{ FAMILY_LABELS.settingsSections.backups }}</h2>
          <p class="hint">
            The backup covers this tool's own data — connections, presets, models
            configuration, the reviewer name. Your locale files and accepted
            translations live in your project folder and travel with it (git keeps
            those safe).
          </p>
          <DataManagement app-name="just-ai-i18n-docgen" />
        </section>
      </template>

      <!-- Storage — JW's Data location + Disk usage, strings verbatim -->
      <template v-else-if="active === 'storage'">
        <section class="card">
          <h2>Data location</h2>
          <p class="hint">
            One folder holds everything this tool saves — your connections, presets,
            the AI engine and models, and logs. Delete the folder, delete it all.
          </p>
          <table class="ui-formgrid">
            <tbody>
              <tr>
                <th>Folder</th>
                <td class="mono">{{ isDesktop ? (storageRoot?.root || "—") : "headless — set by --data-dir / JUST_AI_I18N_DOCGEN_DATA_DIR" }}</td>
              </tr>
              <tr v-if="isDesktop">
                <th>Type</th>
                <td>{{ storageRoot?.portable ? "Portable — beside the app" : "User folder" }}</td>
              </tr>
            </tbody>
          </table>
          <div class="row" style="margin-top: 12px" v-if="isDesktop">
            <UiButton
              intent="secondary" :label="relocating ? 'Moving your data — the app will restart…' : 'Change folder…'"
              :disabled="relocating" @click="changeFolder"
            />
          </div>
          <p v-else class="hint" style="margin: 8px 0 0">Changing the folder is available in the desktop app.</p>
          <p v-if="storageErr" class="mono setup__error">{{ storageErr }}</p>
        </section>

        <section class="card">
          <h2>Disk usage</h2>
          <p class="hint">Where the data folder's space goes — and what can be reclaimed.</p>
          <div class="diskgrid">
            <span class="muted">Models cache</span>
            <div class="row">
              <span>{{ diskSize(diskUsage?.modelsCache) }}</span>
              <UiButton intent="secondary" size="small" :disabled="!!diskBusy"
                        :label="diskBusy === 'models' ? 'Clearing…' : FAMILY_LABELS.storage.clearShort" @click="clearModelsCache" />
            </div>
            <span class="muted">Engine spawn logs</span>
            <div class="row">
              <span>{{ diskSize(diskUsage?.spawnLogs) }}</span>
              <UiButton intent="secondary" size="small" :disabled="!!diskBusy"
                        :label="diskBusy === 'spawn' ? 'Clearing…' : FAMILY_LABELS.storage.clearShort" @click="clearSpawnLogs" />
            </div>
            <span class="muted">Engine builds</span><span>{{ diskSize(diskUsage?.engineBuilds) }}</span>
            <span class="muted">Database</span><span>{{ diskSize(diskUsage?.database) }}</span>
            <span class="muted">{{ FAMILY_LABELS.storage.serverLogs }}</span><span>{{ diskSize(diskUsage?.appLogs) }}</span>
            <span class="muted"><b>{{ FAMILY_LABELS.storage.total }}</b></span><span><b>{{ diskSize(diskUsage?.total) }}</b></span>
            <span class="muted">{{ FAMILY_LABELS.storage.freeSpace }}</span><span>{{ diskSize(diskUsage?.diskFree) }}</span>
          </div>
          <p v-if="diskErr" class="mono setup__error">{{ diskErr }}</p>
        </section>
      </template>

      <!-- Server — headless access + bearer tokens (JW's section) -->
      <template v-else-if="active === 'server'">
        <section class="card">
          <h2>Headless access</h2>
          <p class="hint">
            The server hosts the UI itself — <span class="mono">just-ai-i18n-docgen-server serve</span>
            plus a browser gives the full app without the desktop shell.
          </p>
          <table class="ui-formgrid">
            <tbody>
              <tr><th>URL</th><td class="mono">{{ headlessUrl }}</td></tr>
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
            <span>Keep server running after the app closes</span>
          </label>
          <p class="hint" style="margin-top: 4px">
            With this on, closing the window hides the app to the tray and the
            server keeps serving — use the tray to show the window again or quit
            for real.
          </p>
        </section>
        <section class="card">
          <h2>Access tokens</h2>
          <!-- The donor's words (JW settings.server) — "loopback" was invented at
               port time; JW's user-facing label says localhost (audit 2026-08-05). -->
          <p class="hint">
            Off by default. Add a token to require an
            <span class="mono">Authorization: Bearer</span> header on every
            <span class="mono">/v1</span> API call — for when you run the server
            exposed beyond this machine.
          </p>
          <table class="ui-formgrid" v-if="auth.tokens.length">
            <tbody>
              <tr v-for="t in auth.tokens" :key="t">
                <td class="mono">{{ t }}</td>
                <td style="width: 90px">
                  <UiButton intent="ghost" size="small" label="Remove" @click="dropToken(t)" />
                </td>
              </tr>
            </tbody>
          </table>
          <div class="row" style="margin-top: 10px">
            <UiInput v-model="tokenDraft" width="name" placeholder="new token…" @keydown.enter="addToken" />
            <UiButton intent="secondary" label="Add token" :disabled="!tokenDraft.trim()" @click="addToken" />
          </div>
          <div class="row" style="margin-top: 12px">
            <UiToggle
              :model-value="auth.requireForLoopback" label="Require a token even on localhost"
              @update:model-value="(v) => saveAuth({ requireForLoopback: v })"
            />
          </div>
        </section>
      </template>

      <!-- Logs -->
      <template v-else-if="active === 'logs'">
        <section class="card settings__logs">
          <h2>Server logs</h2>
          <p class="hint">The live ring + per-day files. What the engine actually did, when.</p>
          <LogsPanel />
        </section>
      </template>

      <!-- Reviewer -->
      <!-- Updates — the kit UpdatesPanel (release notes from docs/whats-new.md;
           no auto-updater in this app yet, so the #actions slot stays empty). -->
      <template v-else-if="active === 'updates'">
        <section class="card">
          <UpdatesPanel :app-version="APP_VERSION" :changelog-html="changelogHtml" />
        </section>
      </template>

      <template v-else-if="active === 'reviewer'">
        <section class="card">
          <h2>Reviewer</h2>
          <p class="hint">
            Your name, stamped on every acceptance — so a verdict can say who made it.
            Never taken from the OS. Tool-level: one name across every project.
          </p>
          <!-- Saved on blur/Enter, never per keystroke — typing "dana" used to PUT
               four times, and a mid-word snapshot could stamp an acceptance
               (audit 2026-08-05). -->
          <UiInput
            v-model="reviewerDraft" width="name" placeholder="your name"
            @blur="saveReviewer" @keydown.enter="saveReviewer"
          />
        </section>
      </template>

      <!-- About -->
      <template v-else>
        <section class="card">
          <h2>Just AI i18n &amp; DocGen</h2>
          <p class="hint">Simple translation &amp; help docs for your application — translated locally or online, verified, and reviewed by you.</p>
          <table class="ui-formgrid">
            <tbody>
              <tr><th>Version</th><td class="mono">0.1.0</td></tr>
              <tr>
                <th>Source</th>
                <td><a href="https://github.com/delebash/just_ai_i18n_docgen" @click.prevent="openExternal('https://github.com/delebash/just_ai_i18n_docgen')">github.com/delebash/just_ai_i18n_docgen</a></td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </SettingsShell>
  </div>
</template>
