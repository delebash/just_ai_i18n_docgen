<script setup>
// SPDX-License-Identifier: MIT
// Docs — the authoring half: help articles whose front-matter becomes locale keys,
// so one sentence serves the article, the surface lede and the field hint.
// HONEST STATE: extraction runs from the CLI today; this page says exactly that
// instead of hiding the feature or faking a button that does nothing.
import { PaneHeader } from "@delebash/llm-ui";
</script>

<template>
  <div>
    <!-- The family header shape (kit PaneHeader — parity batch 2026-08-06). -->
    <PaneHeader eyebrow="Help docs" title="Docs" help-key="docs-authoring" />
    <p class="page-sub pane-lede">Front-matter → locale keys. Author once, serve three surfaces.</p>

    <section class="card">
      <h2>How it works</h2>
      <p class="hint" style="margin-bottom: 0">
        A help article's front-matter (title, lede, hints) is extracted into your locale
        files as ordinary keys — then the translate/review pipeline on this very
        dashboard carries them like any other string. One sentence, written once,
        translated once, shipped to the article, the surface lede and the field hint.
      </p>
    </section>

    <section class="card">
      <h2>Run it</h2>
      <p class="hint">The extractor is CLI-only for now — a UI runner is planned, and this page will grow it.</p>
      <pre class="mono setup__pre">just-ai-i18n-docgen extract config.json          # write the keys
just-ai-i18n-docgen extract config.json --check  # drift check only, writes nothing</pre>
    </section>
  </div>
</template>
