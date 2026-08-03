<script setup>
// SPDX-License-Identifier: MIT
// Runs — start a job (202, streamed, cancellable, rejoinable), watch it, and read the
// history ("how did this catalogue get here"). A job stages PROPOSALS only; applying
// is the review page's explicit human action. Close the tab and come back: the page
// rejoins the run it did not start.
import { computed, onMounted, onUnmounted } from "vue";
import { UiButton, UiSelect, pushToast } from "@delebash/llm-ui";
import { ref } from "vue";
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
const pct = computed(() =>
  jobs.job?.total ? Math.round((jobs.job.done / jobs.job.total) * 100) : 0);

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
    <div class="card">
      <h2>Start a run</h2>
      <p class="hint">
        A run stages proposals — it NEVER writes your locale files. pending = missing +
        flagged (the dashboard's button) · flagged = every key the checks or the probe
        flagged · unsure = probe disagreements only · all = every key.
      </p>
      <div class="row">
        <UiSelect v-model="lang" :options="project.langs" width="token" />
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
      <div class="progressbar"><div :style="{ width: pct + '%' }" /></div>
      <p v-if="jobs.job.failed?.length" class="mono" style="color: var(--danger); margin-bottom: 0">
        {{ jobs.job.failed.length }} key(s) exhausted every retry:
        {{ jobs.job.failed.join(", ") }}
      </p>
    </div>

    <div class="card">
      <h2>History</h2>
      <table class="plain" v-if="jobs.runs.length">
        <thead><tr><th>when</th><th>lang</th><th>engine</th><th>scope</th><th>keys</th><th>requests</th><th>failed</th></tr></thead>
        <tbody>
          <tr v-for="r in jobs.runs" :key="r.id">
            <td class="mono">{{ r.startedAt?.slice(0, 19).replace("T", " ") }}</td>
            <td>{{ r.lang }}</td><td class="mono">{{ r.engine }}</td><td>{{ r.scope }}</td>
            <td>{{ r.keys }}</td><td>{{ r.requests }}</td>
            <td :style="r.failed ? 'color: var(--danger)' : ''">{{ r.failed }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted" style="margin: 0">No runs yet.</p>
    </div>
  </div>
</template>
