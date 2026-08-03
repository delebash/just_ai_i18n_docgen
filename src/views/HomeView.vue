<script setup>
// SPDX-License-Identifier: MIT
// Home. With a project: the ruled dashboard (Design 1) — a language is a ROW in the
// kit's UiTable, so 3 or 40 languages is the same page; the header stays put, the
// table sorts/filters itself, and "Translate" runs scope=pending (missing ∪ flagged —
// the server owns that meaning). Without a project: a real welcome, not a bare
// button — the splash plate, the three steps, and the two ways in.
// The run strip is the kit's AiTaskStrip over the translate task the jobs store
// registers — same surface as the AI-tasks panel, no bespoke strip.
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  AiTaskStrip, ConnectionError, Icon, UiButton, UiCheckbox, UiInput, UiTable, UiTag,
  pushToast, serverUrl, useAiTasksStore,
} from "@delebash/llm-ui";
import splashPlate from "../assets/images/splash-plate.jpg";
import { useJobsStore } from "../stores/jobs";
import { useProjectStore } from "../stores/project";

const project = useProjectStore();
const jobs = useJobsStore();
const aiTasks = useAiTasksStore();
const router = useRouter();

const filter = ref("");
const selected = ref([]);

const display = new Intl.DisplayNames(undefined, { type: "language" });
function nameOf(code) {
  try { return display.of(code) || code; } catch { return code; }
}

let retryTimer = null;
onMounted(async () => {
  await Promise.all([project.refresh(), project.fetchSummary(), jobs.refresh()]);
  if (jobs.job?.state === "running") jobs.watch();
  // While the server is unreachable (boot race), keep trying — Home must recover
  // by itself, never stick on a wrong state.
  retryTimer = setInterval(async () => {
    if (project.serverDown) await project.fetchSummary();
  }, 3000);
});
onUnmounted(() => clearInterval(retryTimer));

// A finished run changes every count on this page — refetch when one settles.
watch(() => jobs.job?.state, async (state, prev) => {
  if (prev === "running" && state && state !== "running") await project.fetchSummary();
});

const running = computed(() => jobs.job?.state === "running");
const translateTask = computed(
  () => aiTasks.runningTasks.find((t) => t.feature === "translate") || null,
);
const rows = computed(() =>
  (project.summary?.langs ?? []).map((l) => ({ ...l, name: nameOf(l.code) })),
);
const totals = computed(() => {
  const ls = project.summary?.langs ?? [];
  return {
    findings: ls.reduce((n, l) => n + l.findings, 0),
    staged: ls.reduce((n, l) => n + l.staged, 0),
    accepted: ls.reduce((n, l) => n + l.accepted, 0),
  };
});
const allTicked = computed(
  () => rows.value.length > 0 && rows.value.every((l) => selected.value.includes(l.code)),
);

const COLUMNS = [
  { id: "sel", header: "", enableSorting: false },
  { id: "name", header: "Language", accessorKey: "name" },
  { id: "progress", header: "Progress", accessorKey: "done" },
  { id: "findings", header: "Findings", accessorKey: "findings" },
  { id: "lastRun", header: "Last run", enableSorting: false },
  { id: "go", header: "", enableSorting: false },
];

function pct(l) {
  return l.total ? Math.round((l.done / l.total) * 100) : 0;
}
function toggle(code, on) {
  selected.value = on
    ? [...new Set([...selected.value, code])]
    : selected.value.filter((c) => c !== code);
}
function toggleAll(on) {
  selected.value = on ? rows.value.map((l) => l.code) : [];
}
function openReview(code) {
  router.push({ path: "/review", query: { lang: code } });
}
async function translate(codes) {
  if (!codes.length || running.value) return;
  try {
    await jobs.startMany([...codes], "pending");
  } catch (e) {
    pushToast({ kind: "error", title: "Could not start", description: String(e?.message || e) });
  }
}
function lastRunLabel(l) {
  return l.lastRun?.startedAt ? l.lastRun.startedAt.slice(0, 16).replace("T", " ") : "—";
}
</script>

<template>
  <!-- Server unreachable ≠ no project: the kit's connection screen, retrying. -->
  <ConnectionError
    v-if="project.serverDown" app-name="Just AI i18n & DocGen"
    :server-url="serverUrl('')" need="read your locale files and run translations"
  />

  <!-- CONFIRMED no project (409): the welcome — what this is, and the two ways in. -->
  <div v-else-if="project.noProject" class="intro">
    <img class="intro__plate" :src="splashPlate" alt="Just AI i18n DocGen" />
    <div class="intro__steps">
      <div class="intro__step">
        <b>1 · Point</b>
        <span>at your en.json — the tool reads the locale folder and reports what it found.</span>
      </div>
      <div class="intro__step">
        <b>2 · Translate</b>
        <span>locally and free with your own AI engine — or any online provider you connect.</span>
      </div>
      <div class="intro__step">
        <b>3 · Review</b>
        <span>every finding, accept what's right, and ship translations you've actually seen.</span>
      </div>
    </div>
    <div class="row" style="justify-content: center; gap: 12px">
      <UiButton intent="primary" label="Open Setup" @click="router.push('/setup')" />
      <UiButton intent="secondary" label="Set up local AI" @click="router.push('/ai?quicksetup=1')" />
    </div>
  </div>

  <div v-else-if="project.summary" class="dash">
    <header class="page-head">
      <div>
        <h1>{{ project.appName }}</h1>
        <p class="page-sub">
          {{ project.summary.keyCount.toLocaleString() }} keys · source
          <span class="mono">{{ project.summary.source }}</span> ·
          {{ project.summary.langs.length }} language{{ project.summary.langs.length === 1 ? "" : "s" }}
        </p>
      </div>
      <span class="spacer" />
      <div class="page-head__stats">
        <UiTag v-if="totals.findings" intent="danger" :value="`${totals.findings} findings`" />
        <UiTag v-if="totals.staged" intent="info" :value="`${totals.staged} staged`" />
        <UiTag v-if="totals.accepted" intent="success" :value="`${totals.accepted} accepted`" />
      </div>
    </header>

    <AiTaskStrip v-if="translateTask" class="dash__strip" :task="translateTask" />

    <div class="dash__tools">
      <UiInput v-model="filter" placeholder="Filter languages…" width="id" />
      <span class="spacer" />
      <router-link class="quiet-link" to="/runs">advanced runs ›</router-link>
      <UiButton
        intent="primary"
        :label="running ? 'Running…' : `Translate${selected.length ? ` (${selected.length})` : ''}`"
        :disabled="!selected.length || running"
        title="Missing + flagged keys for the ticked languages"
        @click="translate(selected)"
      />
    </div>

    <div class="dash__scroll">
      <UiTable
        :data="rows" :columns="COLUMNS" data-key="code"
        :global-filter="filter" :global-filter-fields="['name', 'code']"
        row-hover
      >
        <template #sel="{ row }">
          <span @click.stop>
            <UiCheckbox
              :model-value="selected.includes(row.code)"
              @update:model-value="(on) => toggle(row.code, on)"
            />
          </span>
        </template>
        <template #name="{ row }">
          <button class="linklike" @click="openReview(row.code)">
            <b>{{ row.name }}</b> <span class="mono muted">{{ row.code }}</span>
          </button>
        </template>
        <template #progress="{ row }">
          <span class="bar"><i :class="{ full: row.done === row.total && !row.findings }"
                               :style="{ width: pct(row) + '%' }" /></span>
          <span class="mono muted">{{ row.done.toLocaleString() }} / {{ row.total.toLocaleString() }}</span>
        </template>
        <template #findings="{ row }">
          <UiTag v-if="row.done === 0" intent="secondary" value="not yet translated" />
          <template v-else>
            <UiTag v-if="row.findings" intent="danger" :value="`${row.findings} findings`" />
            <UiTag v-if="row.unreviewed" intent="secondary" :value="`${row.unreviewed} unreviewed`" />
            <UiTag v-if="row.staged" intent="info" :value="`${row.staged} staged`" />
            <UiTag v-if="!row.findings && row.done === row.total" intent="success" value="clean" />
          </template>
        </template>
        <template #lastRun="{ row }">
          <span class="muted">{{ lastRunLabel(row) }}</span>
        </template>
        <template #go="{ row }">
          <button class="iconbtn iconbtn--quiet" title="Review" @click="openReview(row.code)">
            <Icon name="ChevRight" :size="14" />
          </button>
        </template>
        <template #empty>
          <span class="muted">No language matches the filter.</span>
        </template>
      </UiTable>
    </div>
    <div class="dash__foot row">
      <UiCheckbox :model-value="allTicked" label="select all" @update:model-value="toggleAll" />
    </div>
  </div>
</template>
