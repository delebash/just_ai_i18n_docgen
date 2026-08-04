<script setup>
// SPDX-License-Identifier: MIT
// The shell — Design 1, ruled 2026-08-03: TitleBar (JW pattern) over a labeled
// sidebar + one main scroller. The boot splash (the user's plate, JW mechanics)
// covers the shell until the server answers and — when "load the default local
// model on startup" is on — the warm load finishes, showing the SAME shared
// DownloadBars the engine panel uses. Continue is the universal escape: a slow
// or failed load never traps anyone on the boot screen.
// Family rules: height:100% chain (never 100vh), one scroller per area.
import { onMounted } from "vue";
import { BootModelLoad, FAMILY_LABELS, Icon, LlmUiHosts, useAiTasksNav, warmModelId } from "@delebash/llm-ui";
import TitleBar from "./components/TitleBar.vue";
import splashPlate from "./assets/images/splash-plate.jpg";
import { useProjectStore } from "./stores/project";

const project = useProjectStore();

const NAV = [
  { to: "/", label: "Home", icon: "Home" },
  { to: "/review", label: "Review", icon: "CheckSquare" },
  { to: "/runs", label: "Runs", icon: "History" },
  { to: "/docs", label: "Docs", icon: "Book" },
];
// The trio's words come from the FAMILY CONTRACT — canon by construction, the
// same "App Settings / AI Settings / AI tasks" every family app shows.
const TOOLS = [
  { to: "/ai", label: FAMILY_LABELS.nav.aiSettings, icon: "Cpu" },
  { to: "/settings", label: FAMILY_LABELS.nav.appSettings, icon: "Settings" },
  { to: "/setup", label: "Setup", icon: "Folder" },
];
// The AI-tasks nav row (JW Sidebar parity): toggles the kit panel, badges the running
// count — red while there are unseen errors. Behaviour AND the required
// `data-panel-toggle` attribute come from the kit, so the row cannot be rebuilt
// without the one attribute that makes it work (see useAiTasksNav).
const aiTasksNav = useAiTasksNav();

// ── boot splash — the PAGE is this app's, the load group is the KIT's ─────
// (2026-08-04 ruling: the loading-model control is shared, the splash page is
// not.) `warmModelId` comes from the kit now — set by main.js's PRE-MOUNT
// startWarmOnBoot(), the one signal this overlay renders on. Everything inside
// the load group — the engine bar, the model bar titled with the MODEL NAME,
// Continue, the auto-dismiss on resident — lives in <BootModelLoad />, so it
// cannot drift from JW again. Nothing loading → no splash → the app just opens.

onMounted(async () => {
  await project.refresh();
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
          <!-- v-bind="navAttrs" carries `data-panel-toggle`: the kit's usePanelDismiss
               exempts elements holding it, so the click that OPENS the panel isn't also
               the outside-click that closes it. Without it the panel opened and
               instantly shut (found live 2026-08-03); it comes from the composable now
               so the row cannot be rebuilt without it. -->
          <button
            class="navlink navlink--btn"
            :class="{ 'router-link-exact-active': aiTasksNav.isOpen.value }"
            v-bind="aiTasksNav.navAttrs" @click="aiTasksNav.toggle"
          >
            <Icon name="Sparkle" :size="17" />
            <span class="nav-label">AI tasks</span>
            <span
              v-if="aiTasksNav.badge.value" class="nav-count"
              :class="{ 'nav-count--error': aiTasksNav.hasErrors.value }"
            >{{ aiTasksNav.badge.value }}</span>
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
    <!-- Every host the shared UI needs, as one tag. It was two, and the day the
         confirm host was missing every confirmed action in the app — Change folder,
         Clear models cache, Clear spawn logs, Apply all staged — became a button that
         did nothing at all, because `confirmDialog()`'s promise never settled. One tag
         so the failure mode is "forgot the hosts", not "mounted some of them". -->
    <LlmUiHosts />

    <!-- ── the boot splash — this app's plate (centre-composed, bars in the art's
         clear bottom strip; JW's is left-empty), the KIT's load group inside it.
         KEEP the plate + fit IN SYNC with index.html #app-boot — the static layer
         shows the same image, so boot is one continuous plate, never two splashes. ── -->
    <div v-if="warmModelId" class="splash">
      <img class="splash__plate" :src="splashPlate" alt="" />
      <div class="splash__strip">
        <BootModelLoad />
      </div>
    </div>
  </div>
</template>
