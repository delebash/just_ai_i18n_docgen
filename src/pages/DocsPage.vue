<script setup>
// SPDX-License-Identifier: MIT
// Docs — the authoring half: help articles whose front-matter becomes locale keys,
// so one sentence serves the article, the surface lede and the field hint.
// HONEST STATE: extraction runs from the CLI today; this page says exactly that
// instead of hiding the feature or faking a button that does nothing.
import { PaneHeader, pageFlow } from "@delebash/ui";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <q-page :style-fn="pageFlow">
    <!-- The family header shape (kit PaneHeader — parity batch 2026-08-06). -->
    <PaneHeader :eyebrow="t('docs.eyebrow')" :title="t('nav.docs')" help-key="docs-authoring" />
    <p class="page-sub pane-lede">{{ t("docs.lede") }}</p>

    <section class="card">
      <h2>{{ t("docs.howTitle") }}</h2>
      <p class="hint" style="margin-bottom: 0">{{ t("docs.howBody") }}</p>
    </section>

    <section class="card">
      <h2>{{ t("docs.runTitle") }}</h2>
      <p class="hint">{{ t("docs.runHint") }}</p>
      <pre class="mono setup__pre"><code>just-ai-i18n-docgen extract config.json</code>          # {{ t("docs.cmdWrite") }}
<code>just-ai-i18n-docgen extract config.json --check</code>  # {{ t("docs.cmdCheck") }}</pre>
    </section>
  </q-page>
</template>
