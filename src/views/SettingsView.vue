<script setup>
// SPDX-License-Identifier: MIT
// Settings — JW's section pattern (/settings/:section?), the standard app chrome
// (2026-08-03 spec): Appearance (kit engine + catalogs, JV-style panel), Storage
// (data root + relocate via the shell's commands, shared disk-usage route), Logs
// (kit LogsPanel over the shared ring), Reviewer (tool-level, moved from Setup),
// About. Every panel is kit-first; the app owns only the wiring.
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  LogsPanel, UiButton, UiInput, UiSegmented, UiSelect,
  fmtBytes, openExternal, pushToast, safeRequest, serverUrl,
} from "@delebash/llm-ui";
import { ACCENT_PRESETS, UI_FONTS, UI_SCALES } from "../services/appearance";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const props = defineProps({ section: { type: String, default: "" } });
const router = useRouter();
const ui = useUiStore();
const project = useProjectStore();

const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "storage", label: "Storage" },
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

// ── appearance ────────────────────────────────────────────────────────────
const MODES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const fontOptions = UI_FONTS.map((f) => f.label);
const mode = computed({
  get: () => ui.appearance.mode || "system",
  set: (m) => ui.setAppearance({ mode: m }),
});
const uiFont = computed({
  get: () => ui.appearance.uiFont || "Inter",
  set: (f) => ui.setAppearance({ uiFont: f }),
});
const uiScale = computed({
  get: () => ui.appearance.uiScale ?? 1,
  set: (v) => ui.setAppearance({ uiScale: v }),
});
function pickAccent(hue) {
  ui.setAppearance({ accentHue: hue });
}

// ── storage ───────────────────────────────────────────────────────────────
const dataRoot = ref("");
const isDesktop = ref(false);
const newRoot = ref("");
const relocating = ref(false);
const usage = ref(null);
const USAGE_ROWS = [
  ["database", "Database"], ["appLogs", "App logs"], ["modelsCache", "Models cache"],
  ["engineBuilds", "Engine builds"], ["spawnLogs", "Engine spawn logs"], ["total", "Total"],
];

async function loadStorage() {
  usage.value = await safeRequest("/v1/disk/usage", null);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    dataRoot.value = await invoke("storage_get_root");
    isDesktop.value = true;
  } catch {
    isDesktop.value = false; // headless: the root is wherever the server was pointed
  }
}
async function relocate() {
  const target = newRoot.value.trim();
  if (!target) return;
  relocating.value = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("storage_relocate", { newRoot: target });
    pushToast({ kind: "success", title: "Data moved", description: target });
    newRoot.value = "";
    await loadStorage();
  } catch (e) {
    pushToast({ kind: "error", title: "Relocate failed", description: String(e) });
  } finally {
    relocating.value = false;
  }
}

// ── reviewer ──────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([project.refresh(), loadStorage()]);
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
      <!-- Appearance -->
      <template v-if="active === 'appearance'">
        <section class="card">
          <h2>Theme</h2>
          <p class="hint">Light and dark both ship; System follows the OS.</p>
          <UiSegmented v-model="mode" :options="MODES" aria-label="Colour mode" />
        </section>
        <section class="card">
          <h2>Accent</h2>
          <p class="hint">The one colour the app leans on.</p>
          <div class="row">
            <button
              v-for="p in ACCENT_PRESETS" :key="p.hue"
              class="swatch" :class="{ on: (ui.appearance.accentHue ?? 243) === p.hue }"
              :style="{ background: `oklch(0.55 0.16 ${p.hue})` }"
              :title="p.name" @click="pickAccent(p.hue)"
            />
          </div>
        </section>
        <section class="card">
          <h2>Type</h2>
          <div class="row">
            <UiSelect v-model="uiFont" :options="fontOptions" width="name" />
            <UiSelect v-model="uiScale" :options="UI_SCALES" width="token" />
          </div>
        </section>
      </template>

      <!-- Storage -->
      <template v-else-if="active === 'storage'">
        <section class="card">
          <h2>Data folder</h2>
          <p class="hint">
            Everything this tool stores — connections, presets, downloaded models,
            logs — lives under ONE folder. Delete the folder, delete it all.
          </p>
          <p class="mono" style="margin: 0 0 12px">
            {{ isDesktop ? dataRoot : "headless — set by --data-dir / JUST_AI_I18N_DOCGEN_DATA_DIR" }}
          </p>
          <template v-if="isDesktop">
            <div class="row">
              <UiInput v-model="newRoot" width="path" placeholder="E:\somewhere\else" />
              <UiButton
                intent="secondary" :label="relocating ? 'Moving…' : 'Move data here'"
                :disabled="relocating || !newRoot.trim()" @click="relocate"
              />
            </div>
            <p class="hint" style="margin: 8px 0 0">
              Stops the server, moves everything, points the app at the new home, restarts.
            </p>
          </template>
        </section>
        <section class="card" v-if="usage">
          <h2>Disk usage</h2>
          <table class="plain">
            <tbody>
              <tr v-for="[key, label] in USAGE_ROWS" :key="key">
                <th>{{ label }}</th><td class="mono">{{ fmtBytes(usage[key] ?? 0) }}</td>
              </tr>
              <tr><th>Free on disk</th><td class="mono">{{ fmtBytes(usage.diskFree ?? 0) }}</td></tr>
            </tbody>
          </table>
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
          <h2>Just AI i18n &amp; Docgen</h2>
          <p class="hint">Translate a locale folder with a local or online AI engine, then prove what was written. Author help docs whose front-matter becomes locale keys.</p>
          <table class="plain">
            <tbody>
              <tr><th>Version</th><td class="mono">0.1.0</td></tr>
              <tr><th>Headless URL</th><td class="mono">{{ serverUrl("") || "same origin" }}</td></tr>
              <tr>
                <th>Source</th>
                <td><a href="#" @click.prevent="openExternal('https://github.com/delebash/just_ai_i18n_docgen')">github.com/delebash/just_ai_i18n_docgen</a></td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </div>
  </div>
</template>
