<script setup>
// SPDX-License-Identifier: MIT
// The shell. ONE markup, three shells — the design variants (temporary, see
// DesignSwitcher) are pure CSS: d1 sidebar with labels, d2 icon rail, d3 top bar.
// Family rules hold in all three: height:100% chain (never 100vh), one scroller
// per area. Toast host lives here so any view can push.
import { computed, onMounted } from "vue";
import { Icon, Toast } from "@delebash/llm-ui";
import DesignSwitcher from "./components/DesignSwitcher.vue";
import { useProjectStore } from "./stores/project";
import { useUiStore } from "./stores/ui";

const ui = useUiStore();
const project = useProjectStore();
onMounted(() => project.refresh());

const NAV = [
  { to: "/", label: "Home", icon: "Home" },
  { to: "/review", label: "Review", icon: "CheckSquare" },
  { to: "/runs", label: "Runs", icon: "History" },
  { to: "/docs", label: "Docs", icon: "Book" },
  { to: "/setup", label: "Setup", icon: "Settings" },
];
const modeIcon = computed(
  () => ({ system: "Monitor", light: "Sun", dark: "Moon" })[ui.appearance.mode || "system"],
);
</script>

<template>
  <div class="shell" :class="`shell--d${ui.design}`">
    <aside class="shell__nav">
      <div class="shell__brand">
        <span class="brand-mark">i18</span>
        <span class="brand-name nav-label">i18n &amp; Docgen</span>
      </div>
      <nav class="shell__links">
        <router-link
          v-for="n in NAV" :key="n.to" :to="n.to"
          class="navlink" :title="n.label"
        >
          <Icon :name="n.icon" :size="17" />
          <span class="nav-label">{{ n.label }}</span>
        </router-link>
      </nav>
      <div class="shell__foot">
        <button
          class="iconbtn" :title="`Theme: ${ui.appearance.mode || 'system'} — click to cycle`"
          @click="ui.cycleMode()"
        >
          <Icon :name="modeIcon" :size="16" />
        </button>
        <span v-if="project.reviewer" class="nav-label shell__reviewer" :title="'Reviewer: ' + project.reviewer">
          {{ project.reviewer }}
        </span>
      </div>
    </aside>
    <main class="shell__main">
      <router-view />
    </main>
    <Toast />
    <DesignSwitcher />
  </div>
</template>
