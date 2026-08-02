<script setup>
// SPDX-License-Identifier: MIT
// Setup — a path box with LIVE validation, never a file picker: a browser file input
// hands JS a File and no path, so real "Browse…" means a directory-listing API over
// localhost (ruled against in the Node repo; still true here). You paste the path and
// the server says immediately what it found — the part that actually prevents mistakes.
//
// The LANGUAGE PICKER is the kit's UiMultiSelect — the component this app caused to be
// born in @delebash/llm-ui. Display names come from Intl.DisplayNames in YOUR locale,
// so no English name can go stale on the server.
import { computed, onMounted, ref } from "vue";
import { UiButton, UiCheckbox, UiField, UiInput, UiMultiSelect, pushToast } from "@delebash/llm-ui";
import { useProjectStore } from "../stores/project";

const project = useProjectStore();
const path = ref("");
const context = ref("");
const targets = ref([]);
const glossary = ref([]);

const display = new Intl.DisplayNames(undefined, { type: "language" });
const languageOptions = computed(() =>
  (project.languages || []).map((code) => {
    let label = code;
    try { label = `${display.of(code)} (${code})`; } catch { /* raw code */ }
    return { label, value: code };
  })
);

onMounted(async () => {
  await project.refresh();
  if (project.loaded && project.source) {
    path.value = project.source;
    await inspect();
    targets.value = [...project.langs];
  }
});

async function inspect() {
  const plan = await project.inspectPath(path.value);
  if (plan) {
    // Existing locale files are FACTS about the folder, offered — not pre-decided.
    if (!targets.value.length) targets.value = plan.locales.map((l) => l.code);
  }
}

function toggleCandidate(word, on) {
  glossary.value = on
    ? [...new Set([...glossary.value, word])]
    : glossary.value.filter((w) => w !== word);
}

async function save() {
  await project.save({
    path: path.value, targets: targets.value,
    context: context.value, glossary: glossary.value,
  });
  pushToast({ kind: "success", title: "Project saved", description: "The workspace is live." });
}
</script>

<template>
  <div>
    <div class="card">
      <h2>Point at your catalogue</h2>
      <p class="hint">
        The path to your source locale file (usually en.json). Its folder is the locale
        folder and its name is the source language — one fact, nothing to disagree with.
      </p>
      <div class="row">
        <UiInput v-model="path" placeholder="E:\\your-app\\src\\i18n\\locales\\en.json"
                 width="path" @keydown.enter="inspect" />
        <UiButton intent="secondary" label="Inspect" @click="inspect" />
      </div>
      <p v-if="project.inspectError" class="mono" style="color: var(--danger)">
        {{ project.inspectError }}
      </p>
    </div>

    <template v-if="project.inspect">
      <div class="card">
        <h2>What the tool understood</h2>
        <p class="hint">
          Seeing this is what proves the path is right before an hour of engine time
          proves it was not.
        </p>
        <table class="plain">
          <tbody>
            <tr><th>Keys</th><td>{{ project.inspect.keyCount }}</td></tr>
            <tr><th>Source language</th><td class="mono">{{ project.inspect.sourceLanguage }}</td></tr>
            <tr>
              <th>Placeholders</th>
              <td class="mono">{{ project.inspect.placeholder.prefix }}…{{ project.inspect.placeholder.suffix }}</td>
            </tr>
            <tr>
              <th>Plural separator</th>
              <td class="mono">{{ project.inspect.pluralSeparator ?? "none" }}</td>
            </tr>
            <tr v-for="l in project.inspect.locales" :key="l.code">
              <th>{{ l.code }}.json</th>
              <td>{{ l.done }}/{{ l.total }} translated, {{ l.missing }} missing</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Target languages</h2>
        <p class="hint">Which languages to translate into. Existing files are offered, never pre-decided.</p>
        <UiMultiSelect v-model="targets" :options="languageOptions"
                       placeholder="Pick target languages…" width="prose" />
      </div>

      <div class="card">
        <h2>Context</h2>
        <p class="hint">One sentence about the app — the one thing only you know.</p>
        <UiInput v-model="context" width="prose"
                 placeholder="e.g. JustWrite, a desktop app for writing novels" />
      </div>

      <div class="card">
        <h2>Glossary candidates</h2>
        <p class="hint">
          Words that recur capitalised mid-sentence. SUGGESTIONS ONLY — every glossary
          term is also a blanket "never translate this", and on a real catalogue one
          wrong term turned 48 correct translations into findings. Tick what is truly a
          brand or product name.
        </p>
        <div class="row">
          <UiCheckbox
            v-for="w in project.inspect.candidates" :key="w"
            :model-value="glossary.includes(w)" :label="w"
            @update:model-value="(on) => toggleCandidate(w, on)"
          />
          <span v-if="!project.inspect.candidates.length" class="muted">none suggested</span>
        </div>
      </div>

      <div class="card">
        <h2>Reviewer</h2>
        <p class="hint">
          Your name, stamped on every acceptance — so a verdict can say who made it.
          Never taken from the OS.
        </p>
        <div class="row">
          <UiInput :model-value="project.reviewer || ''" width="name" placeholder="your name"
                   @update:model-value="(v) => project.setReviewer(v)" />
        </div>
      </div>

      <div class="row">
        <UiButton intent="primary" :label="project.saving ? 'Saving…' : 'Save project'"
                  :disabled="project.saving || !targets.length" @click="save" />
        <span v-if="project.loaded" class="muted mono">{{ project.configPath }}</span>
      </div>

      <div class="card" style="margin-top: 16px">
        <h2>Add to your app's .gitignore</h2>
        <p class="hint">Workshop files a re-run rebuilds. Your decisions (config, accepted, notes) stay committed.</p>
        <pre class="mono" style="margin: 0">{{ project.inspect.gitignore.join("\n") }}</pre>
      </div>
    </template>
  </div>
</template>
