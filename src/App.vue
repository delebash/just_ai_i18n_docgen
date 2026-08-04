<script setup>
// SPDX-License-Identifier: MIT
// The shell — Design 1, ruled 2026-08-03: TitleBar (JW pattern) over a labeled
// sidebar + one main scroller. The boot splash (the user's plate, JW mechanics)
// covers the shell until the server answers and — when "load the default local
// model on startup" is on — the warm load finishes, showing the SAME shared
// DownloadBars the engine panel uses. Continue is the universal escape: a slow
// or failed load never traps anyone on the boot screen.
// Family rules: height:100% chain (never 100vh), one scroller per area.
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { AppDialog, DownloadBar, Icon, Toast, useAiTasksStore, useModelApply, useRunnerModels } from "@delebash/llm-ui";
import TitleBar from "./components/TitleBar.vue";
import splashPlate from "./assets/images/splash-plate.jpg";
import { startWarmOnBoot, warmModelId } from "./services/warmStartup";
import { useProjectStore } from "./stores/project";

const router = useRouter();
const project = useProjectStore();
const aiTasks = useAiTasksStore();

const NAV = [
  { to: "/", label: "Home", icon: "Home" },
  { to: "/review", label: "Review", icon: "CheckSquare" },
  { to: "/runs", label: "Runs", icon: "History" },
  { to: "/docs", label: "Docs", icon: "Book" },
];
const TOOLS = [
  { to: "/ai", label: "AI", icon: "Cpu" },
  { to: "/settings", label: "Settings", icon: "Settings" },
  { to: "/setup", label: "Setup", icon: "Folder" },
];
// The AI-tasks nav row (JW Sidebar parity): toggles the kit panel, badges the
// running count — red while there are unseen errors.
const aiTasksBadge = computed(() => aiTasks.unseenErrors || aiTasks.runningCount || 0);
function toggleAiTasks() {
  aiTasks.panelOpen = !aiTasks.panelOpen;
}

// ── boot splash — JW's rule, restored (2026-08-03) ────────────────────────
// The plate exists ONLY while a warm load is in flight (JW App.vue:184
// `v-if="warmModelId"`). Nothing loading → no splash → the app just opens.
// What was here before was mine, not the donor's: an always-on boot gate with a
// spinner and a status line, a first-run "Set up local AI" call to action, AND a
// second always-present Continue — which is why Continue looked unaligned, there
// were two of them. The offer to set up local AI belongs on Home's welcome (where
// it already is), not stapled to a loading screen.

// JW's warm-boot bars, reused verbatim: the engine-install bar during the
// install phase, then the model's own load bar until it goes resident.
const rm = useRunnerModels();
const warmTask = computed(() => (warmModelId.value ? rm.taskFor(warmModelId.value) : null));
const engineTask = computed(() =>
  rm.engineGateTask?.value && rm.engineGateTask.value.state === "running" ? rm.engineGateTask.value : null);
const warmRowStatus = computed(() =>
  warmModelId.value ? (rm.models.value.find((m) => m.id === warmModelId.value)?.status || "") : "");
// Auto-dismiss shortly after the model goes resident — a 700ms beat (JW App.vue:54:
// taskFor emits running/error/empty, never a "done" state, so the bar simply stops).
// A cancel or an error leaves the bar showing its own Retry; Continue is the universal
// escape, so a slow or failed load never traps anyone on the boot screen.
watch(warmRowStatus, (s) => {
  if (warmModelId.value && (s === "loaded" || s === "sleeping")) {
    setTimeout(dismissSplash, 700);
  }
});
function dismissSplash() {
  warmModelId.value = ""; // the ONE thing the splash renders on
}

onMounted(async () => {
  await project.refresh();
  // Warm-boot runs the SAME workflow every load button runs; it no-ops when the
  // toggle is off or the default isn't a local model. `warmModelId` — set inside —
  // is the only thing that puts a splash on screen.
  await startWarmOnBoot();
});
</script>

<template>
  <div class="shell">
    <TitleBar />
    <div class="shell__body">
      <aside class="shell__nav">
        <div class="shell__brand">
          <span class="brand-mark">i18</span>
          <span class="brand-name">i18n &amp; DocGen</span>
        </div>
        <nav class="shell__links">
          <router-link v-for="n in NAV" :key="n.to" :to="n.to" class="navlink" :title="n.label">
            <Icon :name="n.icon" :size="17" />
            <span class="nav-label">{{ n.label }}</span>
          </router-link>
          <div class="nav-divider" />
          <router-link v-for="n in TOOLS" :key="n.to" :to="n.to" class="navlink" :title="n.label">
            <Icon :name="n.icon" :size="17" />
            <span class="nav-label">{{ n.label }}</span>
          </router-link>
          <!-- data-panel-toggle: the kit's usePanelDismiss exempts this element, so the
               click that OPENS the panel isn't also the outside-click that closes it
               (the missing attr made the panel open-and-instantly-close, found live
               2026-08-03 — JW's Sidebar binds the same attr). -->
          <button
            class="navlink navlink--btn" :class="{ 'router-link-exact-active': aiTasks.panelOpen }"
            data-panel-toggle title="AI tasks" @click="toggleAiTasks"
          >
            <Icon name="Sparkle" :size="17" />
            <span class="nav-label">AI tasks</span>
            <span
              v-if="aiTasksBadge" class="nav-count"
              :class="{ 'nav-count--error': aiTasks.unseenErrors }"
            >{{ aiTasksBadge }}</span>
          </button>
        </nav>
        <div class="shell__foot">
          <span v-if="project.reviewer" class="shell__reviewer" :title="'Reviewer: ' + project.reviewer">
            {{ project.reviewer }}
          </span>
        </div>
      </aside>
      <main class="shell__main">
        <router-view />
      </main>
    </div>
    <Toast />
    <!-- The confirm/prompt HOST (JW App.vue:213). `confirmDialog()` resolves through
         whatever renders this; with no host mounted the promise NEVER settles, so every
         confirmed action — Change folder, Clear models cache, Clear spawn logs, Apply
         all staged — was a button that did nothing at all. Found 2026-08-03 by reading
         the donor's shell instead of its panels; the smoke test asserted the panel
         STRINGS, which is exactly what presence-testing cannot catch. -->
    <AppDialog />

    <!-- ── the boot splash — JW's shape (App.vue:184-193): the plate ONLY while a warm
         load is in flight, its bars in the art's clear bottom strip (this plate is
         centre-composed; JW's is left-empty), and ONE Continue, inside the load group
         it belongs to. No spinner, no status line, no setup CTA — nothing to look at
         when there is nothing to wait for. ── -->
    <div v-if="warmModelId" class="splash">
      <img class="splash__plate" :src="splashPlate" alt="" />
      <div class="splash__strip">
        <DownloadBar v-if="engineTask" :task="engineTask" title="llama.cpp engine" />
        <DownloadBar v-else-if="warmTask" :task="warmTask" :title="warmModelId" />
        <button class="splash__quiet" @click="dismissSplash">Continue without waiting</button>
      </div>
    </div>
  </div>
</template>
