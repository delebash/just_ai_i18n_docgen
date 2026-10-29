<script setup>
// SPDX-License-Identifier: MIT
// This app's title bar = the KIT's TitleBar frame (back / forward over the router's history, the
// centred title, window drag) with this app's right side in its slot: the mode cycler — the kit's
// UiButton with its tooltip and its name, as the template's (a hand-built button until 2026-10-29) —
// and the kit's AiStatusButton, which opens the AI tasks panel (app-structure §4, §11). The title is
// the loaded project's app name, else this app's.
import { AiStatusButton, Icon, TitleBar, UiButton } from "@delebash/ui";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const project = useProjectStore();
const { t } = useI18n();

const title = computed(() => (project.loaded ? project.appName : t("app.name")));
// icon names per mode — ids, not words
const MODE_ICONS = { system: "Monitor", light: "Sun", dark: "Moon" };
const mode = computed(() => ui.appearance.mode || "system");
</script>

<template>
  <TitleBar :title="title">
    <UiButton
      v-tooltip.bottom="t('titleBar.theme', { mode: t(`kit.appearance.panel.mode.${mode}`) })"
      intent="ghost" size="icon" class="titlebar__mode"
      :aria-label="t('titleBar.theme', { mode: t(`kit.appearance.panel.mode.${mode}`) })"
      @click="ui.cycleMode()"
    >
      <template #icon><Icon :name="MODE_ICONS[mode]" :size="16" /></template>
    </UiButton>
    <AiStatusButton />
  </TitleBar>
</template>
