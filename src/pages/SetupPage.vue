<script setup>
// SPDX-License-Identifier: MIT
// Setup — a settings page, not the front door. Two rules, both user-ruled 2026-08-02:
//   1. NOTHING is hidden until a path is entered — the whole form is always visible.
//   2. The path is checked by an explicit button, never automatically on mount.
// A path box with server-side validation, never a file picker: a browser file input
// hands JS a File and no path — that ruling from the Node repo still holds.
// The §15 form (app-structure): the rules are the routes' own schemas (`schemaRules(SetupIn)`, from the server
// package), a refusal the server alone can make — no such file, not a catalog — lands under its field (`fieldErrors`),
// anything else goes through `reportError`.
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  PaneHeader, UiButton, UiCheckbox, UiInput, UiMultiSelect, UiTag, fieldErrors, pageFlow, pushToast, reportError,
  schemaRules,
} from "@delebash/ui";
import { SetupIn, TermIn } from "just-ai-i18n-docgen-server/schemas/setup.js";
import { useRouter } from "vue-router";
import { langOptions } from "../services/langs.js";
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
const rules = schemaRules(SetupIn);
const termRules = schemaRules(TermIn).term;
// the server's words for a field, under it, until that field changes
const serverErrors = ref({});
const FIELDS = ["path", "targets", "context", "glossary"];

/** A refusal tied to one of this form's fields shows under it; anything else is the kit's toast. */
function showError(e) {
  const fields = fieldErrors(e);
  if (FIELDS.some((f) => fields[f])) serverErrors.value = fields;
  else reportError(e);
}

// the languages named in the interface's language, as every other picker names them (services/langs.js —
// this one named them in the browser's language until 2026-10-29)
const languageOptions = computed(() => langOptions(project.languages));

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
  if (checking.value || !path.value.trim()) return;
  checking.value = true;
  serverErrors.value = {};
  try {
    const plan = await project.inspectPath(path.value);
    // Existing locale files are FACTS about the folder, offered — not pre-decided.
    if (plan && !targets.value.length) targets.value = plan.locales.map((l) => l.code);
  } catch (e) {
    showError(e);
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
  serverErrors.value = {};
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
    showError(e);
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

    <q-form greedy @submit="save">
      <div class="setup__grid">
        <section class="card">
          <h2>{{ t("setup.sourceTitle") }}</h2>
          <p class="hint">{{ t("setup.sourceHint") }}</p>
          <!-- items-start: the box's message under it never pulls the button down (a ruled field's row, the kit's §15) -->
          <div class="row items-start">
            <!-- Enter checks the path (it never saves the setup) -->
            <UiInput
              v-model="path" width="path" lazy-rules
              :placeholder="t('setup.pathPlaceholder')" :aria-label="t('setup.sourceTitle')"
              :rules="rules.path" :error="!!serverErrors.path" :error-message="serverErrors.path"
              @update:model-value="serverErrors = {}" @keydown.enter.prevent="check"
            />
            <UiButton
              intent="secondary" :label="checking ? t('common.checking') : t('setup.checkPath')"
              :disabled="checking || !path.trim()" @click="check"
            />
          </div>

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
            :error="!!serverErrors.targets" :error-message="serverErrors.targets"
            @update:model-value="serverErrors = {}"
          />
        </section>

        <section class="card">
          <h2>{{ t("setup.contextTitle") }}</h2>
          <p class="hint">{{ t("setup.contextHint") }}</p>
          <UiInput
            v-model="context" width="prose" lazy-rules
            :placeholder="t('setup.contextPlaceholder')" :aria-label="t('setup.contextTitle')"
            :rules="rules.context" :error="!!serverErrors.context" :error-message="serverErrors.context"
            @update:model-value="serverErrors = {}"
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
          <div class="row items-start">
            <!-- Enter adds the term (it never saves the setup) -->
            <UiInput
              v-model="glossaryDraft" width="name" lazy-rules :rules="termRules"
              :placeholder="t('setup.glossaryPlaceholder')" :aria-label="t('setup.glossaryTitle')"
              :error="!!serverErrors.glossary" :error-message="serverErrors.glossary"
              @update:model-value="serverErrors = {}" @keydown.enter.prevent="addGlossary()"
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
          type="submit" intent="primary" :label="project.saving ? t('kit.common.saving') : t('setup.save')"
          :disabled="project.saving || !path.trim() || !targets.length"
        />
      <i18n-t keypath="setup.saveHint" tag="span" class="hint" style="margin: 0" scope="global">
          <template #link><router-link to="/settings/reviewer">{{ t("setup.reviewerLink") }}</router-link></template>
        </i18n-t>
      </div>
    </q-form>
  </q-page>
</template>
