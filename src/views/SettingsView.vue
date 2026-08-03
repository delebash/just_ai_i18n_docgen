<script setup>
// SPDX-License-Identifier: MIT
// Settings — JW's section pattern (/settings/:section?). Every panel names its
// donor (the 2026-08-03 rule): Storage = JW's Data location + Disk usage panels,
// strings verbatim (app name swapped); Appearance = JV's setting-rows over the kit
// catalogs; Server = JW's headless/auth section over this app's /v1/server-auth;
// Logs = kit LogsPanel; Reviewer = this app's own (tool-level, moved from Setup).
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  LogsPanel, UiButton, UiInput, UiSelect, UiToggle,
  confirmDialog, fmtBytes, get, openExternal, post, pushToast, put, refreshRunnerModels,
  safeRequest, serverUrl,
} from "@delebash/llm-ui";
import { UI_FONTS, UI_SCALES } from "../services/appearance";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const props = defineProps({ section: { type: String, default: "" } });
const router = useRouter();
const ui = useUiStore();
const project = useProjectStore();

const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "storage", label: "Storage" },
  { id: "server", label: "Server" },
  { id: "logs", label: "Logs" },
  { id: "reviewer", label: "Reviewer" },
  { id: "about", label: "About" },
];
const active = ref(props.section || "appearance");
watch(() => props.section, (s) => { if (s) active.value = s; });
function go(id) {
  active.value = id;
  router.replace(`/settings/${id}`);
}

// ── appearance (JV's rows) ────────────────────────────────────────────────
const MODES = [
  { label: "Follow system", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];
const fontOptions = UI_FONTS.map((f) => f.label);

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

onMounted(async () => {
  await Promise.all([project.refresh(), loadStorageRoot(), loadDiskUsage(), loadAuth()]);
});
</script>

<template>
  <div class="settings">
    <aside class="settings__rail">
      <button
        v-for="s in SECTIONS" :key="s.id"
        class="settings__navbtn" :class="{ active: active === s.id }"
        @click="go(s.id)"
      >{{ s.label }}</button>
    </aside>

    <div class="settings__panel">
      <!-- Appearance — JV's setting-rows -->
      <template v-if="active === 'appearance'">
        <section class="card">
          <h2>Appearance</h2>
          <p class="hint">Visual preferences, applied immediately and saved on this machine.</p>
          <div class="setting-row">
            <div class="setting-row__head">
              <div>
                <div class="setting-row__title">Theme</div>
                <div class="setting-row__desc">Light, Dark, or Follow system.</div>
              </div>
              <UiSelect
                :model-value="ui.appearance.mode" width="name" :options="MODES"
                @update:model-value="(v) => ui.setAppearance({ mode: v })"
              />
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__head">
              <div>
                <div class="setting-row__title">Interface size</div>
                <div class="setting-row__desc">Scales the whole interface — labels, controls, and panels — together.</div>
              </div>
              <UiSelect
                :model-value="ui.appearance.uiScale" width="name"
                :options="UI_SCALES.map((s) => ({ label: s.label, value: s.value }))"
                @update:model-value="(v) => ui.setAppearance({ uiScale: Number(v) })"
              />
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__head">
              <div>
                <div class="setting-row__title">UI font</div>
                <div class="setting-row__desc">The interface typeface.</div>
              </div>
              <UiSelect
                :model-value="ui.appearance.uiFont" width="name" :options="fontOptions"
                @update:model-value="(v) => ui.setAppearance({ uiFont: v })"
              />
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__head">
              <div>
                <div class="setting-row__title">Accent hue · {{ ui.appearance.accentHue }}°</div>
                <div class="setting-row__desc">Drag to pick the one colour the app leans on.</div>
              </div>
              <span class="accent-preview" :style="{ background: `oklch(0.538 0.12 ${ui.appearance.accentHue})` }" />
            </div>
            <input
              type="range" :value="ui.appearance.accentHue" min="0" max="360" step="1"
              class="setting-row__slider"
              @input="(e) => ui.setAppearance({ accentHue: Number(e.target.value) })"
            />
          </div>
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
          <table class="plain">
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
                        :label="diskBusy === 'models' ? 'Clearing…' : 'Clear'" @click="clearModelsCache" />
            </div>
            <span class="muted">Engine spawn logs</span>
            <div class="row">
              <span>{{ diskSize(diskUsage?.spawnLogs) }}</span>
              <UiButton intent="secondary" size="small" :disabled="!!diskBusy"
                        :label="diskBusy === 'spawn' ? 'Clearing…' : 'Clear'" @click="clearSpawnLogs" />
            </div>
            <span class="muted">Engine builds</span><span>{{ diskSize(diskUsage?.engineBuilds) }}</span>
            <span class="muted">Database</span><span>{{ diskSize(diskUsage?.database) }}</span>
            <span class="muted">App logs</span><span>{{ diskSize(diskUsage?.appLogs) }}</span>
            <span class="muted"><b>Total</b></span><span><b>{{ diskSize(diskUsage?.total) }}</b></span>
            <span class="muted">Free on disk</span><span>{{ diskSize(diskUsage?.diskFree) }}</span>
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
          <table class="plain">
            <tbody>
              <tr><th>URL</th><td class="mono">{{ headlessUrl }}</td></tr>
            </tbody>
          </table>
        </section>
        <section class="card">
          <h2>Access tokens</h2>
          <p class="hint">
            Bearer tokens gate <span class="mono">/v1/*</span> when the server runs exposed —
            off while this list is empty. Local (loopback) requests stay exempt unless required below.
          </p>
          <table class="plain" v-if="auth.tokens.length">
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
              :model-value="auth.requireForLoopback" label="Require tokens for loopback too"
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
      <template v-else-if="active === 'reviewer'">
        <section class="card">
          <h2>Reviewer</h2>
          <p class="hint">
            Your name, stamped on every acceptance — so a verdict can say who made it.
            Never taken from the OS. Tool-level: one name across every project.
          </p>
          <UiInput
            :model-value="project.reviewer || ''" width="name" placeholder="your name"
            @update:model-value="(v) => project.setReviewer(v)"
          />
        </section>
      </template>

      <!-- About -->
      <template v-else>
        <section class="card">
          <h2>Just AI i18n &amp; DocGen</h2>
          <p class="hint">Simple translation &amp; help docs for your application — translated locally or online, verified, and reviewed by you.</p>
          <table class="plain">
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
    </div>
  </div>
</template>
