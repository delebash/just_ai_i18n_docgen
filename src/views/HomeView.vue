<script setup>
// SPDX-License-Identifier: MIT
// Home. With a project: the ruled dashboard (Design 1) — a language is a ROW in the
// kit's UiTable, so 3 or 40 languages is the same page; the header stays put, the
// table sorts/filters itself, and "Translate" runs scope=pending (missing ∪ flagged —
// the server owns that meaning). Without a project: a real welcome, not a bare
// button — the splash plate, the three steps, and the two ways in.
// The run strip is the kit's AiTaskStrip over the translate task the jobs store
// registers — same surface as the AI-tasks panel, no bespoke strip.
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  AiTaskStrip, Icon, PaneHeader, UiButton, UiCheckbox, UiInput, UiProgress,
  UiTable, UiTag, pushToast, useAiTasksStore, usePoll,
} from "@delebash/llm-ui";
import splashPlate from "../assets/images/splash-plate.jpg";
import { langName } from "../services/langs";
import { useJobsStore } from "../stores/jobs";
import { useProjectStore } from "../stores/project";

const project = useProjectStore();
const jobs = useJobsStore();
const aiTasks = useAiTasksStore();
const router = useRouter();

const filter = ref("");
const selected = ref([]);


// While the server is unreachable (boot race), keep trying — Home must recover by
// itself, never stick on a wrong state. The kit's usePoll (auto-stops on unmount)
// replaced the hand-rolled setInterval, 2026-08-04.
const retry = usePoll(async () => {
  if (project.serverDown) await project.fetchSummary();
}, 3000);
onMounted(async () => {
  await Promise.all([project.refresh(), project.fetchSummary(), jobs.refresh()]);
  if (jobs.job?.state === "running") jobs.watch();
  retry.start();
});

// A finished run changes every count on this page — refetch when one settles.
watch(() => jobs.job?.state, async (state, prev) => {
  if (prev === "running" && state && state !== "running") await project.fetchSummary();
});

const running = computed(() => jobs.job?.state === "running");
const translateTask = computed(
  () => aiTasks.runningTasks.find((t) => t.feature === "translate") || null,
);
const rows = computed(() =>
  (project.summary?.langs ?? []).map((l) => ({ ...l, name: langName(l.code) })),
);
const totals = computed(() => {
  const ls = project.summary?.langs ?? [];
  return {
    findings: ls.reduce((n, l) => n + l.findings, 0),
    staged: ls.reduce((n, l) => n + l.staged, 0),
    accepted: ls.reduce((n, l) => n + l.accepted, 0),
  };
});
// The rows the FILTER currently shows — the same contains-match UiTable applies
// over the same fields. Select-all works on THESE (audit 2026-08-05: it ticked
// every language while the table showed three, and the run started forty).
const visibleRows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter(
    (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q),
  );
});
const allTicked = computed(
  () => visibleRows.value.length > 0
    && visibleRows.value.every((l) => selected.value.includes(l.code)),
);

// `sortable` is the kit column key (audit 2026-08-05: `enableSorting: false` was
// TanStack's name, silently ignored — no column sorted at all).
const COLUMNS = [
  { id: "sel", header: "" },
  { id: "name", header: "Language", accessorKey: "name", sortable: true },
  { id: "progress", header: "Progress", accessorKey: "done", sortable: true },
  // "Status", not "Findings": the chips under it say "not yet translated" / "6 staged"
  // / "clean" as often as they say findings.
  { id: "findings", header: "Status", accessorKey: "findings", sortable: true },
  { id: "lastRun", header: "Last run" },
  { id: "go", header: "" },
];

function toggle(code, on) {
  selected.value = on
    ? [...new Set([...selected.value, code])]
    : selected.value.filter((c) => c !== code);
}
function toggleAll(on) {
  selected.value = on ? visibleRows.value.map((l) => l.code) : [];
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
  <!-- Server-down now mounts the kit ConnectionError INSTEAD of the app (main.js —
       JW's pattern): a dead server breaks every view, not just Home. -->
  <!-- CONFIRMED no project (409): the welcome — what this is, and the two ways in. -->
  <div v-if="project.noProject" class="intro">
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
    <!-- ONE door (ruling R3, 2026-08-04): the permanent "Set up local AI" button is
         retired — the once-ever kit AiSetupOffer (App.vue) owns first AI contact. -->
    <div class="row" style="justify-content: center; gap: 12px">
      <UiButton intent="primary" label="Open Setup" @click="router.push('/setup')" />
    </div>
  </div>

  <!-- Server unreachable AFTER boot (main.js's gate only covers boot): say so and
       keep retrying — a blank page reads as broken (audit 2026-08-05). -->
  <div v-else-if="project.serverDown" class="intro">
    <p class="muted" style="text-align: center">
      Can't reach the server — retrying…
    </p>
  </div>

  <div v-else-if="project.summary" class="dash">
    <!-- The family header shape (kit PaneHeader — parity batch 2026-08-06);
         the key-count line + status tags ride the actions slot. -->
    <PaneHeader eyebrow="Project" :title="project.appName" help-key="getting-started">
      <p class="page-sub head-sub">
        {{ project.summary.keyCount.toLocaleString() }} keys · source
        <span class="mono">{{ project.summary.source }}</span> ·
        {{ project.summary.langs.length }} language{{ project.summary.langs.length === 1 ? "" : "s" }}
      </p>
      <UiTag v-if="totals.findings" intent="danger" :value="`${totals.findings} findings`" />
      <UiTag v-if="totals.staged" intent="info" :value="`${totals.staged} staged`" />
      <UiTag v-if="totals.accepted" intent="success" :value="`${totals.accepted} accepted`" />
    </PaneHeader>

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
        <!-- Select-all belongs in the checkbox column's HEADER, above the boxes it
             controls — not in a strip under the table, which is where it sat until the
             kit's UiTable grew a head-<id> slot (2026-08-03). -->
        <template #head-sel>
          <span @click.stop>
            <UiCheckbox :model-value="allTicked" title="Select every language"
                        @update:model-value="toggleAll" />
          </span>
        </template>
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
          <span class="progresscell">
            <UiProgress bare :value="row.done" :max="row.total" />
            <span class="mono muted">{{ row.done.toLocaleString() }} / {{ row.total.toLocaleString() }}</span>
          </span>
        </template>
        <template #findings="{ row }">
          <!-- A run STAGES proposals, it never writes the locale file — so done=0
               with staged work is the first-run state, not "nothing happened"
               ('not yet translated' beside a finished Last run read as a failed
               run — the fr row, 2026-08-03). -->
          <UiTag v-if="row.done === 0 && !row.staged" intent="secondary" value="not yet translated" />
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
  </div>
</template>
