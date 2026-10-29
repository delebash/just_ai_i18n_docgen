<script setup>
// SPDX-License-Identifier: MIT
// The app's chrome — Quasar's layout as its CLI creates it (app-structure §Q.1), the template's
// layouts/MainLayout.vue with this app's pages (2026-10-29; Design 1, ruled 2026-08-03):
//   - the title bar (components/TitleBar.vue — the kit's frame, the mode cycler, AiStatusButton);
//   - the nav in the drawer: Home, Review, Runs, Docs, then the kit's "AI Settings" / "App Settings"
//     and Setup, then the "AI tasks" row, which spreads the kit's navAttrs (its data-panel-toggle
//     keeps the panel from closing on the very click that opens it) — Quasar's QList/QItem, so the
//     rows are Quasar's own links and the kit's common/app.css styles them; under them the reviewer's
//     name (this app's);
//   - the one content scroller (pages flow in it: pageFlow);
//   - <LlmUiHosts/> (the kit's dialogs, toasts and panels — with one missing, a confirm never
//     answers), <HelpDrawer/>, the once-ever AI offer (fired by Setup's first save);
//   - the warm-start splash: this app's plate (the same image as index.html's), the kit's
//     <BootModelLoad/> inside it, shown while the kit's `warmModelId` is set;
//   - the tray's renderer half (Open settings, About, Copy server URL) and keep-running, re-applied
//     to the shell every start (the shell forgets it per launch), and the listeners dropped when the
//     layout goes;
//   - the shell's two menus in the app's language (the kit's shellTrayLabels / shellMenuLabels).
// Family rules: a height:100% chain (never 100vh), one scroller per area.
import { copyToClipboard } from "quasar";
import {
  AiSetupOffer, BootModelLoad, HelpDrawer, Icon, LlmUiHosts, pushToast, shellMenuLabels, shellTrayLabels, useAiTasksNav,
  warmModelId,
} from "@delebash/ui";
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import splashPlate from "../assets/images/splash-plate.jpg";
import TitleBar from "../components/TitleBar.vue";
import { onShellEvent, setContextMenuLabels, setKeepRunning, setTrayLabels } from "../services/native.js";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const { t, locale } = useI18n();
const ui = useUiStore();
const project = useProjectStore();
const router = useRouter();

// The app's pages, then the family's two (their words are the kit's, `kit.nav.*`, the same in every
// app) and Setup. Icon names are ids, not words.
const NAV = computed(() => [
  { to: "/", label: t("nav.home"), icon: "Home", exact: true },
  { to: "/review", label: t("nav.review"), icon: "CheckSquare" },
  { to: "/runs", label: t("nav.runs"), icon: "History" },
  { to: "/docs", label: t("nav.docs"), icon: "Book" },
]);
const TOOLS = computed(() => [
  { to: "/ai", label: t("kit.nav.aiSettings"), icon: "Cpu" },
  { to: "/settings", label: t("kit.nav.appSettings"), icon: "Settings" },
  { to: "/setup", label: t("nav.setup"), icon: "Folder" },
]);
const aiTasksNav = useAiTasksNav();
// The drawer's width, which QDrawer takes in pixels (the kit's common/app.css .shell__nav fills it).
const NAV_WIDTH = 200;

// The shell's menus speak the app's language; it holds only their English until told.
watch(locale, () => {
  setTrayLabels(shellTrayLabels(t, t("app.name")));
  setContextMenuLabels(shellMenuLabels(t));
}, { immediate: true });

const unsubscribe = [];
onMounted(async () => {
  if (ui.keepServerRunning) setKeepRunning(true);
  unsubscribe.push(
    onShellEvent("tray:open-settings", () => router.push("/settings")),
    onShellEvent("tray:about", () => router.push("/settings/about")),
    onShellEvent("tray:copy-url", async (url) => {
      // A focused window's clipboard write is reliable; the shell shows the window first (§11).
      try {
        await copyToClipboard(String(url));
        pushToast({ kind: "success", title: t("tray.urlCopied"), description: String(url) });
      } catch (err) {
        pushToast({ kind: "error", title: t("tray.copyFailed"), description: String(err?.message || err) });
      }
    }),
  );
  await project.refresh();
});
onBeforeUnmount(() => {
  for (const off of unsubscribe.splice(0)) off();
});
</script>

<template>
  <!-- view "hhh lpr fff": the title bar over the full width, the nav under it on the left — neither
       fixed: the layout's root is fixed to the window and never scrolls (the content scroller
       does), and a fixed drawer is a compositing layer of its own (measured on JustWrite,
       2026-10-09). The drawer keeps desktop behaviour at every width. -->
  <q-layout view="hhh lpr fff" class="shell">
    <q-header>
      <TitleBar />
    </q-header>

    <q-drawer :model-value="true" side="left" behavior="desktop" :width="NAV_WIDTH">
      <nav class="shell__nav">
        <div class="shell__brand">
          <span class="brand-mark">{{ t("app.mark") }}</span>
          <span class="brand-name">{{ t("app.wordmark") }}</span>
        </div>
        <q-list class="shell__links">
          <q-item
            v-for="n in NAV" :key="n.to" :to="n.to" :exact="n.exact"
            class="navlink" active-class="navlink--active" dense
          >
            <q-item-section avatar class="navlink__icon"><Icon :name="n.icon" :size="17" /></q-item-section>
            <q-item-section>{{ n.label }}</q-item-section>
          </q-item>
          <q-separator class="nav-divider" />
          <q-item
            v-for="n in TOOLS" :key="n.to" :to="n.to"
            class="navlink" active-class="navlink--active" dense
          >
            <q-item-section avatar class="navlink__icon"><Icon :name="n.icon" :size="17" /></q-item-section>
            <q-item-section>{{ n.label }}</q-item-section>
          </q-item>
          <!-- v-bind="navAttrs" carries `data-panel-toggle` (the kit's useAiTasksNav): without it the
               click that opens the panel is also its outside-click, and it shuts at once. -->
          <q-item
            clickable dense class="navlink navlink--tasks" :active="aiTasksNav.isOpen.value"
            active-class="navlink--active" v-bind="aiTasksNav.navAttrs" @click="aiTasksNav.toggle"
          >
            <q-item-section avatar class="navlink__icon"><Icon name="Sparkle" :size="17" /></q-item-section>
            <q-item-section>{{ t("kit.nav.aiTasks") }}</q-item-section>
            <q-item-section v-if="aiTasksNav.badge.value" side>
              <q-badge class="nav-count" :class="{ 'nav-count--error': aiTasksNav.hasErrors.value }">
                {{ aiTasksNav.badge.value }}
              </q-badge>
            </q-item-section>
          </q-item>
        </q-list>
        <!-- the name every acceptance is stamped with (Settings → Reviewer) — this app's -->
        <div class="shell__foot">
          <span v-if="project.reviewer" class="shell__reviewer" :title="t('nav.reviewer', { name: project.reviewer })">
            {{ project.reviewer }}
          </span>
        </div>
      </nav>
    </q-drawer>

    <q-page-container>
      <div class="shell__main">
        <router-view />
      </div>
    </q-page-container>

    <LlmUiHosts />
    <HelpDrawer />
    <!-- The once-ever AI offer (ruling R3): opened by Setup's first save on a machine with no
         default AI provider; the flag is kept whatever the user picks. -->
    <AiSetupOffer
      v-if="ui.aiOfferOpen" :app-name="t('app.name')"
      @close="ui.closeAiOffer()"
      @quick-setup="router.push('/ai?quicksetup=1')"
      @connect-provider="router.push('/ai?providers=online')"
    />

    <!-- The warm-start splash — this app's plate (keep the image and its fit in step with
         index.html's #app-boot), the kit's load group inside it. -->
    <div v-if="warmModelId" class="splash">
      <img class="splash__plate" :src="splashPlate" alt="" />
      <div class="splash__strip">
        <BootModelLoad />
      </div>
    </div>
  </q-layout>
</template>
