<script setup>
// SPDX-License-Identifier: MIT
// Runs — start a job (202, followed, cancellable, rejoinable), watch it, and read the
// history ("how did this catalogue get here"). A job stages PROPOSALS only; applying
// is the review page's explicit human action. Close the tab and come back: the page
// rejoins the run it did not start, and a finished run's card is read from its record. A running
// run shows here as the kit's AiTaskStrip (its progress and the one Cancel — app-structure §8: the
// screen that starts a task shows its strip, and the global stack leaves it out), as on Home.
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { AiTaskStrip, PaneHeader, UiButton, UiProgress, UiSelect, UiTable, otherWindows, pushToast, pageFlow, useSurfaceTask } from "@delebash/ui";
import { ref } from "vue";
import { langLabel, langOptions } from "../services/langs";
import { useJobsStore } from "../stores/jobs";
import { useProjectStore } from "../stores/project";

const project = useProjectStore();
const jobs = useJobsStore();
const { t, te, d } = useI18n();
const lang = ref(null);
const scope = ref("pending");

onMounted(async () => {
  await project.refresh();
  lang.value = project.langs[0] ?? null;
  await jobs.refresh();
});

// another window's change (the kit's otherWindows): the run and the history read again
watch(() => otherWindows.changes, () => jobs.refresh());
const running = computed(() => jobs.running);
const translateTask = useSurfaceTask("translate");
const run = computed(() => jobs.run);

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
// the kit job's states in this page's words: a running job's phase, and "error" said as failed
const stateWord = (r) => {
  const s = r.state === "running" ? (r.phase === "confirming" ? "confirming" : "running") : r.state === "error" ? "failed" : r.state;
  return te(`runs.state.${s}`) ? t(`runs.state.${s}`) : s;
};

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
      </div>
      <AiTaskStrip v-if="translateTask" class="runs__strip" :task="translateTask" />
      <p v-if="jobs.error" class="mono" style="color: var(--danger)">{{ jobs.error }}</p>
    </div>

    <div class="card" v-if="run">
      <h2>{{ t(running ? "runs.jobRunning" : "runs.jobLast", { lang: run.lang, scope: scopeWord(run.scope) }) }}</h2>
      <p class="hint">
        {{ t("runs.jobProgress", { done: run.done, total: run.total, requests: run.requests, state: stateWord(run) }) }}
        <template v-if="run.error"> · {{ run.error }}</template>
      </p>
      <UiProgress v-if="!running" :value="run.done" :max="run.total" />
      <p v-if="run.failed.length" class="mono" style="color: var(--danger); margin-bottom: 0">
        {{ t("runs.exhausted", { n: run.failed.length, keys: run.failed.join(", ") }, run.failed.length) }}
      </p>
    </div>

    <div class="card">
      <h2>{{ t("runs.history") }}</h2>
      <UiTable
        :data="jobs.runs" :columns="historyColumns" data-key="id"
        :default-sort="{ id: 'when', desc: true }"
      >
        <template #when="{ row }">
          <span class="mono">{{ row.startedAt ? d(new Date(row.startedAt), "dateTime") : "" }}</span>
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
