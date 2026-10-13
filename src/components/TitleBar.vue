<script setup>
// SPDX-License-Identifier: MIT
// This app's title bar = the KIT's TitleBar frame (back/forward + title, the
// shared mechanics — swapped on 2026-08-04, the contract's tier-3 lift) with this
// app's right side in the slot: the mode cycler and the kit's AiStatusButton
// (which carries the AI-tasks panel mount).
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { AiStatusButton, Icon, TitleBar } from "@delebash/llm-ui";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const project = useProjectStore();
const { t } = useI18n();

const title = computed(() =>
  project.loaded ? project.appName : t("app.name"));
// Icon names per theme mode — ids, not words.
const MODE_ICONS = { system: "Monitor", light: "Sun", dark: "Moon" };
const modeIcon = computed(() => MODE_ICONS[ui.appearance.mode || "system"]);
</script>

<template>
  <TitleBar :title="title">
    <button
      class="iconbtn" :title="t('titleBar.theme', { mode: t(`kit.appearance.panel.mode.${ui.appearance.mode || 'system'}`) })"
      @click="ui.cycleMode()"
    >
      <Icon :name="modeIcon" :size="16" />
    </button>
    <AiStatusButton />
  </TitleBar>
</template>
