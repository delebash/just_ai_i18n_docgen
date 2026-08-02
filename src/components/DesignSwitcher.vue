<script setup>
// SPDX-License-Identifier: MIT
// TEMPORARY — the live design-iteration switch (2026-08-02). Three shells share the
// same working routes and data; this pill flips between them so a design can be
// judged in the real app. Delete this file (and ui.design) once one is ruled.
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const DESIGNS = [
  { n: 1, label: "1", hint: "Sidebar + table dashboard" },
  { n: 2, label: "2", hint: "Compact rail + master-detail" },
  { n: 3, label: "3", hint: "Top bar + stat hero" },
];
</script>

<template>
  <div class="design-pill" title="Temporary: switch the design candidate">
    <span class="design-pill__label">design</span>
    <button
      v-for="d in DESIGNS" :key="d.n"
      class="design-pill__btn" :class="{ on: ui.design === d.n }"
      :title="d.hint" @click="ui.setDesign(d.n)"
    >{{ d.label }}</button>
  </div>
</template>
