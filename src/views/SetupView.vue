<script setup>
// SPDX-License-Identifier: MIT
// Setup — a settings page, not the front door. Two rules, both user-ruled 2026-08-02:
//   1. NOTHING is hidden until a path is entered — the whole form is always visible.
//   2. The path is checked by an explicit button, never automatically on mount.
// A path box with server-side validation, never a file picker: a browser file input
// hands JS a File and no path — that ruling from the Node repo still holds.
import { computed, onMounted, ref } from "vue";
import { UiButton, UiCheckbox, UiChip, UiInput, UiMultiSelect, pushToast } from "@delebash/llm-ui";
import { useRouter } from "vue-router";
import { useProjectStore } from "../stores/project";

const project = useProjectStore();
const router = useRouter();
const path = ref("");
const context = ref("");
const targets = ref([]);
const glossary = ref([]);
const glossaryDraft = ref("");
const checking = ref(false);

const display = new Intl.DisplayNames(undefined, { type: "language" });
const languageOptions = computed(() =>
  (project.languages || []).map((code) => {
    let label = code;
    try { label = `${display.of(code)} (${code})`; } catch { /* raw code */ }
    return { label, value: code };
  }),
);

onMounted(async () => {
  // Prefill from the loaded project — but never check the path for you.
  await project.refresh();
  if (project.loaded) {
    path.value = project.source ?? "";
    targets.value = [...project.langs];
    context.value = project.context ?? "";
    glossary.value = [...project.glossary];
  }
});

async function check() {
  checking.value = true;
  try {
    const plan = await project.inspectPath(path.value);
    // Existing locale files are FACTS about the folder, offered — not pre-decided.
    if (plan && !targets.value.length) targets.value = plan.locales.map((l) => l.code);
  } finally {
    checking.value = false;
  }
}

function addGlossary(word) {
  const w = (word ?? glossaryDraft.value).trim();
  if (w && !glossary.value.includes(w)) glossary.value = [...glossary.value, w];
  glossaryDraft.value = "";
}
function dropGlossary(word) {
  glossary.value = glossary.value.filter((x) => x !== word);
}

async function save() {
  try {
    await project.save({
      path: path.value, targets: targets.value,
      context: context.value, glossary: glossary.value,
    });
    pushToast({ kind: "success", title: "Project saved", description: "The dashboard is live." });
    router.push("/");
  } catch (e) {
    pushToast({ kind: "error", title: "Could not save", description: String(e?.message || e) });
  }
}
</script>

<template>
  <div class="setup">
    <header class="page-head">
      <div>
        <h1>Setup</h1>
        <p class="page-sub">Point the tool at your app's catalogue. Nothing here runs an engine.</p>
      </div>
      <span class="spacer" />
      <span v-if="project.loaded" class="mono muted">{{ project.configPath }}</span>
    </header>

    <div class="setup__grid">
      <section class="card">
        <h2>Catalogue path</h2>
        <p class="hint">
          The path to your source locale file (usually en.json). Its folder is the locale
          folder and its name is the source language — one fact, nothing to disagree with.
        </p>
        <div class="row">
          <UiInput
            v-model="path" width="path"
            placeholder="E:\your-app\src\i18n\locales\en.json"
            @keydown.enter="check"
          />
          <UiButton
            intent="secondary" :label="checking ? 'Checking…' : 'Check path'"
            :disabled="checking || !path.trim()" @click="check"
          />
        </div>
        <p v-if="project.inspectError" class="mono setup__error">{{ project.inspectError }}</p>

        <table class="plain" style="margin-top: 12px">
          <tbody>
            <tr>
              <th>Keys</th>
              <td>{{ project.inspect ? project.inspect.keyCount : "—" }}</td>
            </tr>
            <tr>
              <th>Source language</th>
              <td class="mono">{{ project.inspect ? project.inspect.sourceLanguage : "—" }}</td>
            </tr>
            <tr>
              <th>Placeholders</th>
              <td class="mono">
                {{ project.inspect
                  ? `${project.inspect.placeholder.prefix}…${project.inspect.placeholder.suffix}` : "—" }}
              </td>
            </tr>
            <tr>
              <th>Plural separator</th>
              <td class="mono">{{ project.inspect ? (project.inspect.pluralSeparator ?? "none") : "—" }}</td>
            </tr>
            <tr v-for="l in project.inspect?.locales ?? []" :key="l.code">
              <th>{{ l.code }}.json</th>
              <td>{{ l.done }}/{{ l.total }} translated, {{ l.missing }} missing</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!project.inspect" class="hint" style="margin: 8px 0 0">
          Press <b>Check path</b> and the tool reports what it found — the part that
          catches a wrong path before an hour of engine time does.
        </p>
      </section>

      <section class="card">
        <h2>Target languages</h2>
        <p class="hint">Which languages to translate into. Existing files are offered after a check, never pre-decided.</p>
        <UiMultiSelect
          v-model="targets" :options="languageOptions"
          placeholder="Pick target languages…" width="prose"
        />
      </section>

      <section class="card">
        <h2>Context</h2>
        <p class="hint">One sentence about the app — the one thing only you know.</p>
        <UiInput
          v-model="context" width="prose"
          placeholder="e.g. JustWrite, a desktop app for writing novels"
        />
      </section>

      <section class="card">
        <h2>Glossary — never translate these</h2>
        <p class="hint">
          A term here is a BLANKET rule for every string. On a real catalogue one wrong
          term turned 48 correct translations into findings — add only true brand and
          product names. A word that is a label in one string and prose in another
          belongs in review acceptances, not here.
        </p>
        <div class="row" v-if="glossary.length" style="margin-bottom: 8px">
          <UiChip
            v-for="w in glossary" :key="w" :label="`${w} ✕`"
            :title="`Remove ${w}`" @click="dropGlossary(w)"
          />
        </div>
        <div class="row">
          <UiInput
            v-model="glossaryDraft" width="name" placeholder="add a term…"
            @keydown.enter="addGlossary()"
          />
          <UiButton intent="ghost" label="Add" :disabled="!glossaryDraft.trim()" @click="addGlossary()" />
        </div>
        <template v-if="project.inspect?.candidates?.length">
          <p class="hint" style="margin: 12px 0 6px">
            Suggested from your catalogue (words recurring capitalised mid-sentence) — tick to add:
          </p>
          <div class="row">
            <UiCheckbox
              v-for="w in project.inspect.candidates" :key="w"
              :model-value="glossary.includes(w)" :label="w"
              @update:model-value="(on) => (on ? addGlossary(w) : dropGlossary(w))"
            />
          </div>
        </template>
        <p v-else-if="project.inspect" class="hint" style="margin: 12px 0 0">No candidates suggested.</p>
      </section>

      <section class="card">
        <h2>Your app's .gitignore</h2>
        <p class="hint">Workshop files a re-run rebuilds. Your decisions (config, accepted, notes) stay committed.</p>
        <pre v-if="project.inspect" class="mono setup__pre">{{ project.inspect.gitignore.join("\n") }}</pre>
        <p v-else class="hint" style="margin: 0">Shown after a path check.</p>
      </section>
    </div>

    <div class="setup__actions">
      <UiButton
        intent="primary" :label="project.saving ? 'Saving…' : 'Save project'"
        :disabled="project.saving || !path.trim() || !targets.length" @click="save"
      />
      <span class="hint" style="margin: 0">
        Saving writes config.json beside your locales and loads it — no restart.
        Your reviewer name lives in <router-link to="/settings/reviewer">Settings → Reviewer</router-link>.
      </span>
    </div>
  </div>
</template>
