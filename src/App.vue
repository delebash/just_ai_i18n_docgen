<!-- SPDX-License-Identifier: MIT -->
<script setup>
// The root component Quasar mounts (the kit's app-structure §Q.1): the app's shell (AppShell.vue)
// or — when the server didn't answer at start-up — the kit's connection-error screen in its place.
// The boot file decides (boot/docgen.js sets services/bootState.js). Before the Quasar move,
// main.js mounted one of the two as its own app.
import { onMounted } from "vue";
import { ConnectionError, serverUrl } from "@delebash/llm-ui";
import AppShell from "./AppShell.vue";
import { bootView } from "./services/bootState.js";

// index.html's static boot plate covers the window until Vue renders; the shell's own splash
// takes over from here.
onMounted(() => document.getElementById("app-boot")?.remove());
</script>

<template>
  <ConnectionError
    v-if="bootView === 'server-down'"
    app-name="Just AI i18n & DocGen"
    :server-url="serverUrl('')"
    need="read your locale files and run translations"
    dev-hint="Dev: it should start automatically with `npm run dev`, or run it yourself with `npm run server`, then retry."
  />
  <AppShell v-else />
</template>
