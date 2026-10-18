<script setup>
// SPDX-License-Identifier: MIT
// Runs — start a job (202, streamed, cancellable, rejoinable), watch it, and read the
// history ("how did this catalogue get here"). A job stages PROPOSALS only; applying
// is the review page's explicit human action. Close the tab and come back: the page
// rejoins the run it did not start.
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { PaneHeader, UiButton, UiProgress, UiSelect, UiTable, pushToast, pageFlow } from "@delebash/ui";
import { ref } from "vue";
import { langLabel, langOptions } from "../services/langs";
import { useJobsStore } from "../stores/jobs";
import { useProjectStore } from "../stores/project";

const project = useProjectStore();
const jobs = useJobsStore();
const { t, te } = useI18n();
const lang = ref(null);
const scope = ref("pending");

onMounted(async () => {
  await project.refresh();
  lang.value = project.langs[0] ?? null;
  await jobs.refresh();
  if (jobs.job?.state === "running") jobs.watch();
});
onUnmounted(() => jobs.unwatch());

const running = computed(() => jobs.job?.state === "running");

// History on the SHARED table (2026-08-03) — this page had a hand-rolled `table.plain`
// beside the dashboard's UiTable, which is two table looks in one app and the exact
// duplication the kit exists to stop. Sorting comes free, and "which run failed keys"
// is the question this list is read for.
const historyColumns = computed(() => [
  { id: "when", header: t("runs.colWhen"), accessorKey: "startedAt", sortable: true },
  { id: "lang", header: t("common.language"), accessorKey: "lang", sortable: true },
  { id: "engine", header: t("runs.colEngine"), accessorKey: "engine", sortable: true },
  { id: "scope", header: t("runs.colScope"), accessorKey: "scope", sortable: true },
  { id: "keys", header: t("common.keys"), accessorKey: "keys", sortable: true },
  { id: "requests", header: t("runs.colRequests"), accessorKey: "requests", sortable: true },
  { id: "failed", header: t("runs.colFailed"), accessorKey: "failed", sortable: true },
]);
// A run's scope and state are the server's ids; each known one has its word.
const SCOPES = ["pending", "flagged", "unsure", "all"];
const scopeOptions = computed(() => SCOPES.map((s) => ({ label: t(`runs.scope.${s}`), value: s })));
const scopeWord = (s) => (te(`runs.scope.${s}`) ? t(`runs.scope.${s}`) : s);
const stateWord = (s) => (te(`runs.state.${s}`) ? t(`runs.state.${s}`) : s);

async function start() {
  try {
    await jobs.start({ lang: lang.value, scope: scope.value });
  } catch (e) {
    pushToast({ kind: "error", title: t("common.couldNotStart"), description: String(e?.message || e) });
  }
}
</script>

<template>
  <q-page :style-fn="pageFlow">
    <!-- The family header shape (kit PaneHeader — parity batch 2026-08-06). -->
    <PaneHeader :eyebrow="t('common.translating')" :title="t('nav.runs')" help-key="translate" />
    <div class="card">
      <h2>{{ t("runs.startTitle") }}</h2>
      <p class="hint">
        {{ t("runs.startHint", { pending: scopeWord("pending"), flagged: scopeWord("flagged"), unsure: scopeWord("unsure"), all: scopeWord("all") }) }}
      </p>
      <div class="row">
        <UiSelect v-model="lang" :options="langOptions(project.langs)" width="id" />
        <UiSelect v-model="scope" :options="scopeOptions" width="token" />
        <UiButton intent="primary" :label="jobs.starting ? t('runs.starting') : t('common.translate')"
                  :disabled="running || jobs.starting || !lang" @click="start" />
        <UiButton v-if="running" intent="danger-outline" :label="t('runs.cancel')"
                  @click="jobs.cancel()" />
      </div>
      <p v-if="jobs.error" class="mono" style="color: var(--danger)">{{ jobs.error }}</p>
    </div>

    <div class="card" v-if="jobs.job">
      <h2>{{ t(running ? "runs.jobRunning" : "runs.jobLast", { lang: jobs.job.lang, scope: scopeWord(jobs.job.scope) }) }}</h2>
      <p class="hint">
        {{ t("runs.jobProgress", { done: jobs.job.done, total: jobs.job.total, requests: jobs.job.requests, state: stateWord(jobs.job.state) }) }}
        <template v-if="jobs.job.error"> · {{ jobs.job.error }}</template>
      </p>
      <UiProgress :value="jobs.job.done" :max="jobs.job.total" />
      <p v-if="jobs.job.failed?.length" class="mono" style="color: var(--danger); margin-bottom: 0">
        {{ t("runs.exhausted", { n: jobs.job.failed.length, keys: jobs.job.failed.join(", ") }, jobs.job.failed.length) }}
      </p>
    </div>

    <div class="card">
      <h2>{{ t("runs.history") }}</h2>
      <UiTable
        :data="jobs.runs" :columns="historyColumns" data-key="id"
        :default-sort="{ id: 'when', desc: true }"
      >
        <template #when="{ row }">
          <span class="mono">{{ row.startedAt?.slice(0, 19).replace("T", " ") }}</span>
        </template>
        <template #lang="{ row }">{{ langLabel(row.lang) }}</template>
        <template #engine="{ row }"><span class="mono">{{ row.engine }}</span></template>
        <template #failed="{ row }">
          <span :style="row.failed ? 'color: var(--danger); font-weight: 600' : ''">{{ row.failed }}</span>
        </template>
        <template #scope="{ row }">{{ scopeWord(row.scope) }}</template>
        <template #empty><span class="muted">{{ t("runs.none") }}</span></template>
      </UiTable>
    </div>
  </q-page>
</template>
