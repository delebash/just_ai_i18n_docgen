<script setup>
// SPDX-License-Identifier: MIT
// Setup — a settings page, not the front door. Two rules, both user-ruled 2026-08-02:
//   1. NOTHING is hidden until a path is entered — the whole form is always visible.
//   2. The path is checked by an explicit button, never automatically on mount.
// A path box with server-side validation, never a file picker: a browser file input
// hands JS a File and no path — that ruling from the Node repo still holds.
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { PaneHeader, UiButton, UiCheckbox, UiInput, UiMultiSelect, UiTag, pushToast, pageFlow } from "@delebash/llm-ui";
import { useRouter } from "vue-router";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const project = useProjectStore();
const ui = useUiStore();
const router = useRouter();
const { t } = useI18n();
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
    pushToast({ kind: "success", title: t("setup.saved"), description: t("setup.savedBody") });
    // The once-ever AI offer's moment (the trigger ruling: Setup-save, JW's
    // donor semantics). Not awaited — navigation stays snappy; the App-level
    // modal pops when the provider check answers.
    ui.maybeOfferAiSetup();
    router.push("/");
  } catch (e) {
    pushToast({ kind: "error", title: t("common.couldNotSave"), description: String(e?.message || e) });
  }
}
</script>

<template>
  <q-page :style-fn="pageFlow" class="setup">
    <!-- The family header shape (kit PaneHeader — parity batch 2026-08-06);
         the loaded config path rides the actions slot. -->
    <PaneHeader :eyebrow="t('common.project')" :title="t('nav.setup')" help-key="project-setup">
      <span v-if="project.loaded" class="mono muted">{{ project.configPath }}</span>
    </PaneHeader>
    <p class="page-sub pane-lede">{{ t("setup.lede") }}</p>

    <div class="setup__grid">
      <section class="card">
        <h2>{{ t("setup.sourceTitle") }}</h2>
        <p class="hint">{{ t("setup.sourceHint") }}</p>
        <div class="row">
          <UiInput
            v-model="path" width="path"
            :placeholder="t('setup.pathPlaceholder')"
            @keydown.enter="check"
          />
          <UiButton
            intent="secondary" :label="checking ? t('common.checking') : t('setup.checkPath')"
            :disabled="checking || !path.trim()" @click="check"
          />
        </div>
        <p v-if="project.inspectError" class="mono setup__error">{{ project.inspectError }}</p>

        <table class="ui-formgrid" style="margin-top: 12px">
          <tbody>
            <tr>
              <th>{{ t("common.keys") }}</th>
              <td>{{ project.inspect ? project.inspect.keyCount : "—" }}</td>
            </tr>
            <tr>
              <th>{{ t("setup.sourceLanguage") }}</th>
              <td class="mono">{{ project.inspect ? project.inspect.sourceLanguage : "—" }}</td>
            </tr>
            <tr>
              <th>{{ t("setup.placeholders") }}</th>
              <td class="mono">
                {{ project.inspect
                  ? `${project.inspect.placeholder.prefix}…${project.inspect.placeholder.suffix}` : "—" }}
              </td>
            </tr>
            <tr>
              <th>{{ t("setup.pluralSeparator") }}</th>
              <td class="mono">{{ project.inspect ? (project.inspect.pluralSeparator ?? t("setup.none")) : "—" }}</td>
            </tr>
            <tr v-for="l in project.inspect?.locales ?? []" :key="l.code">
              <th>{{ `${l.code}.json` }}</th>
              <td>{{ t("setup.localeCounts", { done: l.done, total: l.total, missing: l.missing }) }}</td>
            </tr>
          </tbody>
        </table>
        <i18n-t v-if="!project.inspect" keypath="setup.checkHint" tag="p" class="hint" style="margin: 8px 0 0" scope="global">
          <template #button><b>{{ t("setup.checkPath") }}</b></template>
        </i18n-t>
      </section>

      <section class="card">
        <h2>{{ t("setup.targetsTitle") }}</h2>
        <p class="hint">{{ t("setup.targetsHint") }}</p>
        <UiMultiSelect
          v-model="targets" :options="languageOptions"
          :placeholder="t('setup.targetsPlaceholder')" width="prose"
        />
      </section>

      <section class="card">
        <h2>{{ t("setup.contextTitle") }}</h2>
        <p class="hint">{{ t("setup.contextHint") }}</p>
        <UiInput
          v-model="context" width="prose"
          :placeholder="t('setup.contextPlaceholder')"
        />
      </section>

      <section class="card">
        <h2>{{ t("setup.glossaryTitle") }}</h2>
        <p class="hint">{{ t("setup.glossaryHint") }}</p>
        <div class="row" v-if="glossary.length" style="margin-bottom: 8px">
          <UiTag
            v-for="w in glossary" :key="w" intent="secondary" :value="w"
            removable @remove="dropGlossary(w)"
          />
        </div>
        <div class="row">
          <UiInput
            v-model="glossaryDraft" width="name" :placeholder="t('setup.glossaryPlaceholder')"
            @keydown.enter="addGlossary()"
          />
          <UiButton intent="ghost" :label="t('common.add')" :disabled="!glossaryDraft.trim()" @click="addGlossary()" />
        </div>
        <template v-if="project.inspect?.candidates?.length">
          <p class="hint" style="margin: 12px 0 6px">{{ t("setup.candidatesHint") }}</p>
          <div class="row">
            <UiCheckbox
              v-for="w in project.inspect.candidates" :key="w"
              :model-value="glossary.includes(w)" :label="w"
              @update:model-value="(on) => (on ? addGlossary(w) : dropGlossary(w))"
            />
          </div>
        </template>
        <p v-else-if="project.inspect" class="hint" style="margin: 12px 0 0">{{ t("setup.noCandidates") }}</p>
      </section>

      <section class="card">
        <h2>{{ t("setup.gitignoreTitle") }}</h2>
        <p class="hint">{{ t("setup.gitignoreHint") }}</p>
        <pre v-if="project.inspect" class="mono setup__pre">{{ project.inspect.gitignore.join("\n") }}</pre>
        <p v-else class="hint" style="margin: 0">{{ t("setup.gitignoreAfterCheck") }}</p>
      </section>
    </div>

    <div class="setup__actions">
      <UiButton
        intent="primary" :label="project.saving ? t('kit.common.saving') : t('setup.save')"
        :disabled="project.saving || !path.trim() || !targets.length" @click="save"
      />
      <i18n-t keypath="setup.saveHint" tag="span" class="hint" style="margin: 0" scope="global">
        <template #link><router-link to="/settings/reviewer">{{ t("setup.reviewerLink") }}</router-link></template>
      </i18n-t>
    </div>
  </q-page>
</template>
