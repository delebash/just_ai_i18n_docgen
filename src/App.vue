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
import { DownloadBar, Icon, Toast, useAiTasksStore, useModelApply, useRunnerModels } from "@delebash/llm-ui";
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

// ── boot splash ───────────────────────────────────────────────────────────
const splash = ref(true);
const splashStatus = ref("starting the local server…");
const needsLocalSetup = ref(false);

// JW's warm-boot bars, reused verbatim: the engine-install bar during the
// install phase, then the model's own load bar until it goes resident.
const rm = useRunnerModels();
const warmTask = computed(() => (warmModelId.value ? rm.taskFor(warmModelId.value) : null));
const engineTask = computed(() =>
  rm.engineGateTask?.value && rm.engineGateTask.value.state === "running" ? rm.engineGateTask.value : null);
const warmRowStatus = computed(() =>
  warmModelId.value ? (rm.models.value.find((m) => m.id === warmModelId.value)?.status || "") : "");
watch(warmRowStatus, (s) => {
  if (warmModelId.value && (s === "loaded" || s === "sleeping")) {
    setTimeout(() => { warmModelId.value = ""; dismissSplash(); }, 700);
  }
});
function dismissSplash() {
  splash.value = false;
  warmModelId.value = "";
}
function goQuickSetup() {
  dismissSplash();
  router.push("/ai?quicksetup=1");
}

onMounted(async () => {
  await project.refresh();
  splashStatus.value = "checking the local AI…";
  try {
    const { refreshApplied, currentDefaultId } = useModelApply();
    await refreshApplied();
    needsLocalSetup.value = !currentDefaultId.value;
  } catch { /* server still booting — the pages degrade honestly */ }
  await startWarmOnBoot();
  if (!warmModelId.value) setTimeout(dismissSplash, 500); // a brand beat, not a wait
  else splashStatus.value = "loading your model…";
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

    <!-- ── the boot splash — the plate, with the interactive layer in its clear
         bottom strip (this art is centre-composed; JW's plate is left-empty) ── -->
    <div v-if="splash" class="splash">
      <img class="splash__plate" :src="splashPlate" alt="" />
      <div class="splash__strip">
        <template v-if="warmModelId">
          <p class="splash__status">Loading {{ warmModelId }}…</p>
          <DownloadBar v-if="engineTask" :task="engineTask" />
          <DownloadBar v-else-if="warmTask" :task="warmTask" />
        </template>
        <template v-else-if="needsLocalSetup">
          <p class="splash__status">
            No local AI yet — set one up in a minute, free, on this PC.
          </p>
          <div class="row" style="justify-content: center">
            <button class="splash__cta" @click="goQuickSetup">Set up local AI</button>
            <button class="splash__quiet" @click="dismissSplash">Continue without it</button>
          </div>
        </template>
        <template v-else>
          <span class="splash__spin" />
          <p class="splash__status">{{ splashStatus }}</p>
        </template>
        <button class="splash__quiet splash__continue" @click="dismissSplash">Continue</button>
      </div>
    </div>
  </div>
</template>
