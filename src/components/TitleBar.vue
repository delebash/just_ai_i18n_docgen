<script setup>
// SPDX-License-Identifier: MIT
// This app's title bar = the KIT's TitleBar frame (back/forward + title, the
// shared mechanics — swapped on 2026-08-04, the contract's tier-3 lift) with this
// app's right side in the slot: the mode cycler and the kit's AiStatusButton
// (which carries the AI-tasks panel mount).
import { computed } from "vue";
import { AiStatusButton, Icon, TitleBar } from "@delebash/llm-ui";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const project = useProjectStore();

const title = computed(() =>
  project.loaded ? project.appName : "Just AI i18n & DocGen");
const modeIcon = computed(
  () => ({ system: "Monitor", light: "Sun", dark: "Moon" })[ui.appearance.mode || "system"],
);
</script>

<template>
  <TitleBar :title="title">
    <button
      class="iconbtn" :title="`Theme: ${ui.appearance.mode || 'system'} — click to cycle`"
      @click="ui.cycleMode()"
    >
      <Icon :name="modeIcon" :size="16" />
    </button>
    <AiStatusButton />
  </TitleBar>
</template>
