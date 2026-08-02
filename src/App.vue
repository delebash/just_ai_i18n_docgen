<script setup>
// SPDX-License-Identifier: MIT
// The shell: sidebar nav + one main scroller (the family height:100% chain — never
// 100vh). Toast host lives here so any view can push.
import { onMounted } from "vue";
import { Toast } from "@delebash/llm-ui";
import { useProjectStore } from "./stores/project";

const project = useProjectStore();
onMounted(() => project.refresh());
</script>

<template>
  <div class="shell">
    <nav class="shell-nav">
      <div class="shell-brand">Just AI i18n &amp; Docgen</div>
      <router-link to="/setup">Setup</router-link>
      <router-link to="/review">Review</router-link>
      <router-link to="/runs">Runs</router-link>
    </nav>
    <main class="shell-main">
      <router-view />
    </main>
    <Toast />
  </div>
</template>
