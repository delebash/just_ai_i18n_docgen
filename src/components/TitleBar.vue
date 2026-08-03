<script setup>
// SPDX-License-Identifier: MIT
// The in-app title bar — JW's TitleBar pattern adapted (back/forward over the
// router's history state, the current title centred, the mode toggle and the
// kit's AiStatusButton on the right — which carries the AI-tasks panel mount).
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { AiStatusButton, Icon } from "@delebash/llm-ui";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const router = useRouter();
const ui = useUiStore();
const project = useProjectStore();

const title = computed(() =>
  project.loaded ? project.appName : "Just AI i18n & DocGen");
const modeIcon = computed(
  () => ({ system: "Monitor", light: "Sun", dark: "Moon" })[ui.appearance.mode || "system"],
);

// Browser-style nav history (JW's exact approach): Vue Router stamps back/forward
// onto the history state, so the buttons light up only when there's somewhere to go.
const canBack = ref(false);
const canForward = ref(false);
function syncNav() {
  const st = window.history.state || {};
  canBack.value = st.back != null;
  canForward.value = st.forward != null;
}
let stopAfterEach;
onMounted(() => {
  syncNav();
  stopAfterEach = router.afterEach(() => setTimeout(syncNav, 0));
});
onBeforeUnmount(() => stopAfterEach?.());
</script>

<template>
  <header class="titlebar">
    <button class="iconbtn" :disabled="!canBack" title="Back" @click="router.back()">
      <Icon name="ChevLeft" :size="16" />
    </button>
    <button class="iconbtn" :disabled="!canForward" title="Forward" @click="router.forward()">
      <Icon name="ChevRight" :size="16" />
    </button>
    <span class="titlebar__title">{{ title }}</span>
    <span class="spacer" />
    <button
      class="iconbtn" :title="`Theme: ${ui.appearance.mode || 'system'} — click to cycle`"
      @click="ui.cycleMode()"
    >
      <Icon :name="modeIcon" :size="16" />
    </button>
    <AiStatusButton />
  </header>
</template>
