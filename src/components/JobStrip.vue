<script setup>
// SPDX-License-Identifier: MIT
// The live run strip — shown wherever a job matters (the dashboard, all designs).
// SSE-fed via the jobs store; a run stages proposals only, and the strip says so.
import { computed } from "vue";
import { UiButton } from "@delebash/llm-ui";
import { useJobsStore } from "../stores/jobs";

const jobs = useJobsStore();
const running = computed(() => jobs.job?.state === "running");
const pct = computed(() =>
  jobs.job?.total ? Math.round((jobs.job.done / jobs.job.total) * 100) : 0);
const langNames = new Intl.DisplayNames(undefined, { type: "language" });
function nameOf(code) {
  try { return langNames.of(code); } catch { return code; }
}
</script>

<template>
  <div v-if="running" class="jobstrip">
    <span class="jobstrip__spin" />
    <span class="jobstrip__title">Translating {{ nameOf(jobs.job.lang) }}</span>
    <div class="jobstrip__bar"><div :style="{ width: pct + '%' }" /></div>
    <span class="jobstrip__meta">
      {{ jobs.job.done }} / {{ jobs.job.total }} staged · {{ jobs.job.requests }} request(s)
      <template v-if="jobs.queue.length"> · then {{ jobs.queue.map(nameOf).join(", ") }}</template>
    </span>
    <UiButton intent="ghost" size="small" label="Cancel" @click="jobs.cancel()" />
  </div>
</template>
