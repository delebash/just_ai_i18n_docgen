<script setup>
// SPDX-License-Identifier: MIT
// The kit's whole AI area — providers, model catalog + downloads, routing by
// feature (live wiring: engine.make_send reads those presets), usage, console.
// The KIT wizard runs here since the surgery (2026-08-04) — this app's voice
// rides main.js's quickSetupCopy, the capability hides embeddings, the family
// cache-offer lives in the kit step. It honours JW's ?quicksetup=1 deep link.
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AiModelsArea, PaneHeader, useModelApply } from "@delebash/llm-ui";

const route = useRoute();
const router = useRouter();

// The deep link is a ONE-SHOT INSTRUCTION, not a place. Read it once into a plain ref
// and strip it from the URL: bound straight to `route.query` it reopened the wizard on
// every remount and on Back (the TitleBar has one) — "quicksetup popped up again when
// you navigate to AI even though the model loaded" (user, 2026-08-03). JW never had
// this: its offer fires once ever off a persisted flag, not a URL parameter.
const openWizardOnce = ref(route.query.quicksetup === "1");

onMounted(async () => {
  if (!openWizardOnce.value) return;
  // …and never offer to set up a machine that IS set up. The link exists for a box with
  // no local AI; arriving with a default already applied, the wizard is pure noise.
  try {
    const { refreshApplied, currentDefaultProviderId } = useModelApply();
    await refreshApplied();
    if (currentDefaultProviderId.value) openWizardOnce.value = false;
  } catch { /* unknown → let it open; the unconfigured box is the case it serves */ }
  router.replace({ path: "/ai" }); // consumed either way
});
</script>

<template>
  <div class="ai-page">
    <!-- The family header shape (kit PaneHeader) with JW's canon words for this
         page — same eyebrow, same title, every app. -->
    <PaneHeader eyebrow="AI" title="Providers, routing &amp; usage" help-key="ai-setup" />
    <div class="ai-area">
      <!-- No @quick-setup-closed handler: closing the wizard used to fling you to Home,
           which is disorienting when you opened the AI page on purpose. You stay here. -->
      <!-- No :wizard override since the surgery (2026-08-04): the KIT wizard runs here,
           voiced by main.js's quickSetupCopy, embeddings hidden by the capability, the
           family cache-offer inside it. The 359-line fork is deleted. -->
      <AiModelsArea :auto-open-quick-setup="openWizardOnce"
        :initial-provider-scope="route.query.providers === 'online' ? 'online' : ''"
        :data-links="[
          { label: 'Context & glossary', href: '#/setup' },
          { label: 'Per-key notes', href: '#/review' },
        ]" />
    </div>
  </div>
</template>
