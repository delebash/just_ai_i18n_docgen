<script setup>
// SPDX-License-Identifier: MIT
// Runs — start a job (202, streamed, cancellable, rejoinable), watch it, and read the
// history ("how did this catalogue get here"). A job stages PROPOSALS only; applying
// is the review page's explicit human action. Close the tab and come back: the page
// rejoins the run it did not start.
import { computed, onMounted, onUnmounted } from "vue";
import { PaneHeader, UiButton, UiProgress, UiSelect, UiTable, pushToast } from "@delebash/llm-ui";
import { ref } from "vue";
import { langLabel, langOptions } from "../services/langs";
import { useJobsStore } from "../stores/jobs";
import { useProjectStore } from "../stores/project";

const project = useProjectStore();
const jobs = useJobsStore();
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
const HISTORY_COLUMNS = [
  { id: "when", header: "When", accessorKey: "startedAt", sortable: true },
  { id: "lang", header: "Language", accessorKey: "lang", sortable: true },
  { id: "engine", header: "Engine", accessorKey: "engine", sortable: true },
  { id: "scope", header: "Scope", accessorKey: "scope", sortable: true },
  { id: "keys", header: "Keys", accessorKey: "keys", sortable: true },
  { id: "requests", header: "Requests", accessorKey: "requests", sortable: true },
  { id: "failed", header: "Failed", accessorKey: "failed", sortable: true },
];

async function start() {
  try {
    await jobs.start({ lang: lang.value, scope: scope.value });
  } catch (e) {
    pushToast({ kind: "error", title: "Could not start", description: String(e?.message || e) });
  }
}
</script>

<template>
  <div>
    <!-- The family header shape (kit PaneHeader — parity batch 2026-08-06). -->
    <PaneHeader eyebrow="Translating" title="Runs" help-key="translate" />
    <div class="card">
      <h2>Start a run</h2>
      <p class="hint">
        A run stages proposals — it NEVER writes your locale files. pending = missing +
        flagged (the dashboard's button) · flagged = every key the checks or the probe
        flagged · unsure = probe disagreements only · all = every key.
      </p>
      <div class="row">
        <UiSelect v-model="lang" :options="langOptions(project.langs)" width="id" />
        <UiSelect v-model="scope" :options="['pending', 'flagged', 'unsure', 'all']" width="token" />
        <UiButton intent="primary" :label="jobs.starting ? 'Starting…' : 'Translate'"
                  :disabled="running || jobs.starting || !lang" @click="start" />
        <UiButton v-if="running" intent="danger-outline" label="Cancel (keeps staged work)"
                  @click="jobs.cancel()" />
      </div>
      <p v-if="jobs.error" class="mono" style="color: var(--danger)">{{ jobs.error }}</p>
    </div>

    <div class="card" v-if="jobs.job">
      <h2>{{ running ? "Running" : "Last job" }} — {{ jobs.job.lang }} · {{ jobs.job.scope }}</h2>
      <p class="hint">
        {{ jobs.job.done }}/{{ jobs.job.total }} staged · {{ jobs.job.requests }} request(s)
        · state: {{ jobs.job.state }}
        <template v-if="jobs.job.error"> · {{ jobs.job.error }}</template>
      </p>
      <UiProgress :value="jobs.job.done" :max="jobs.job.total" />
      <p v-if="jobs.job.failed?.length" class="mono" style="color: var(--danger); margin-bottom: 0">
        {{ jobs.job.failed.length }} key(s) exhausted every retry:
        {{ jobs.job.failed.join(", ") }}
      </p>
    </div>

    <div class="card">
      <h2>History</h2>
      <UiTable
        :data="jobs.runs" :columns="HISTORY_COLUMNS" data-key="id"
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
        <template #empty><span class="muted">No runs yet.</span></template>
      </UiTable>
    </div>
  </div>
</template>
