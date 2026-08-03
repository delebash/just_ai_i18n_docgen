<script setup>
// SPDX-License-Identifier: MIT
// The kit's whole AI area — providers, model catalog + downloads, routing by
// feature (live wiring: engine.make_send reads those presets), usage, console.
// This app passes its OWN thin setup wizard through the kit's wizard seam
// (machinery in the kit, steps and words per app — the family wizard rule),
// and honours JW's ?quicksetup=1 deep link (the splash's "Set up local AI").
import { useRoute, useRouter } from "vue-router";
import { AiModelsArea } from "@delebash/llm-ui";
import QuickSetupI18n from "../components/QuickSetupI18n.vue";

const route = useRoute();
const router = useRouter();
</script>

<template>
  <div class="ai-page">
    <header class="page-head">
      <div>
        <h1>AI</h1>
        <p class="page-sub">Providers, models, routing and usage — the shared runner surface.</p>
      </div>
    </header>
    <div class="ai-area">
      <AiModelsArea
        :wizard="QuickSetupI18n"
        :auto-open-quick-setup="route.query.quicksetup === '1'"
        @quick-setup-closed="router.push('/')"
      />
    </div>
  </div>
</template>
