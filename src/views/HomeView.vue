<script setup>
// SPDX-License-Identifier: MIT
// Home — the dashboard. A language is a ROW (or a compact card), never a fat stacked
// panel: 3 or 40 languages is the same page, the header stays pinned, only the list
// scrolls, and the filter box handles big sets. Data is ONE call (/v1/summary);
// "Translate" runs scope=pending (missing ∪ flagged — the server owns that meaning).
//
// Three compositions, one data set (temporary, judged live via DesignSwitcher):
//   d1 table dashboard · d2 master-detail · d3 stat hero + card grid
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { EmptyState, Icon, UiButton, UiCheckbox, UiInput, pushToast } from "@delebash/llm-ui";
import JobStrip from "../components/JobStrip.vue";
import { useJobsStore } from "../stores/jobs";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const project = useProjectStore();
const jobs = useJobsStore();
const router = useRouter();

const filter = ref("");
const selected = ref([]); // codes ticked for a bulk run (d1)
const activeLang = ref(null); // d2's master-detail selection

const display = new Intl.DisplayNames(undefined, { type: "language" });
function nameOf(code) {
  try { return display.of(code) || code; } catch { return code; }
}

onMounted(async () => {
  await Promise.all([project.refresh(), project.fetchSummary(), jobs.refresh()]);
  if (jobs.job?.state === "running") jobs.watch();
  activeLang.value = project.summary?.langs?.[0]?.code ?? null;
});

// A finished run changes every count on this page — refetch when one settles.
watch(() => jobs.job?.state, async (state, prev) => {
  if (prev === "running" && state && state !== "running") await project.fetchSummary();
});

const running = computed(() => jobs.job?.state === "running");
const langs = computed(() => {
  const list = project.summary?.langs ?? [];
  const q = filter.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (l) => l.code.toLowerCase().includes(q) || nameOf(l.code).toLowerCase().includes(q),
  );
});
const active = computed(
  () => langs.value.find((l) => l.code === activeLang.value) ?? langs.value[0] ?? null,
);
const totals = computed(() => {
  const ls = project.summary?.langs ?? [];
  return {
    findings: ls.reduce((n, l) => n + l.findings, 0),
    unreviewed: ls.reduce((n, l) => n + l.unreviewed, 0),
    accepted: ls.reduce((n, l) => n + l.accepted, 0),
    staged: ls.reduce((n, l) => n + l.staged, 0),
  };
});
const allTicked = computed(
  () => langs.value.length > 0 && langs.value.every((l) => selected.value.includes(l.code)),
);

function pct(l) {
  return l.total ? Math.round((l.done / l.total) * 100) : 0;
}
function toggle(code, on) {
  selected.value = on
    ? [...new Set([...selected.value, code])]
    : selected.value.filter((c) => c !== code);
}
function toggleAll(on) {
  selected.value = on ? langs.value.map((l) => l.code) : [];
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
  <!-- No project yet: the honest front door, one action. -->
  <EmptyState
    v-if="!project.summary" icon="Folder"
    title="Point me at a catalogue"
    message="Give Setup the path to your en.json — the tool reads the folder, reports what it found, and this page comes alive."
    action-label="Open Setup" @action="router.push('/setup')"
  />

  <div v-else class="dash">
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
      <div class="page-head__stats" v-if="ui.design !== 3">
        <span v-if="totals.findings" class="chip chip--danger">{{ totals.findings }} findings</span>
        <span v-if="totals.staged" class="chip chip--info">{{ totals.staged }} staged</span>
        <span v-if="totals.accepted" class="chip chip--success">{{ totals.accepted }} accepted</span>
      </div>
    </header>

    <JobStrip />

    <!-- ── d3's stat hero ─────────────────────────────────────────────── -->
    <div v-if="ui.design === 3" class="hero">
      <div class="hero__stat">
        <b>{{ project.summary.keyCount.toLocaleString() }}</b><span>keys</span>
      </div>
      <div class="hero__stat">
        <b>{{ project.summary.langs.length }}</b><span>languages</span>
      </div>
      <div class="hero__stat" :class="{ 'hero__stat--danger': totals.findings }">
        <b>{{ totals.findings }}</b><span>findings</span>
      </div>
      <div class="hero__stat">
        <b>{{ totals.unreviewed }}</b><span>unreviewed</span>
      </div>
      <div class="hero__stat hero__stat--success">
        <b>{{ totals.accepted }}</b><span>accepted</span>
      </div>
    </div>

    <div class="dash__tools">
      <UiInput v-model="filter" placeholder="Filter languages…" width="id" />
      <span class="spacer" />
      <router-link class="quiet-link" to="/runs">advanced runs ›</router-link>
      <UiButton
        v-if="ui.design === 1"
        intent="primary"
        :label="running ? 'Running…' : `Translate${selected.length ? ` (${selected.length})` : ''}`"
        :disabled="!selected.length || running"
        :title="'Missing + flagged keys for the ticked languages'"
        @click="translate(selected)"
      />
      <UiButton
        v-else-if="ui.design === 3"
        intent="primary"
        :label="running ? 'Running…' : 'Translate all pending'"
        :disabled="running || !langs.length"
        @click="translate(langs.map((l) => l.code))"
      />
    </div>

    <!-- ── d1: the table ──────────────────────────────────────────────── -->
    <div v-if="ui.design === 1" class="dash__scroll">
      <table class="langtable">
        <thead>
          <tr>
            <th class="langtable__cb">
              <UiCheckbox :model-value="allTicked" @update:model-value="toggleAll" />
            </th>
            <th>Language</th><th>Progress</th><th>Findings</th><th>Last run</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in langs" :key="l.code" class="langrow" @click="openReview(l.code)">
            <td class="langtable__cb" @click.stop>
              <UiCheckbox
                :model-value="selected.includes(l.code)"
                @update:model-value="(on) => toggle(l.code, on)"
              />
            </td>
            <td><b>{{ nameOf(l.code) }}</b> <span class="mono muted">{{ l.code }}</span></td>
            <td class="langtable__progress">
              <span class="bar"><i :class="{ full: l.done === l.total && !l.findings }"
                                  :style="{ width: pct(l) + '%' }" /></span>
              <span class="mono muted">{{ l.done.toLocaleString() }} / {{ l.total.toLocaleString() }}</span>
            </td>
            <td>
              <span v-if="l.done === 0" class="chip chip--muted">not yet translated</span>
              <template v-else>
                <span v-if="l.findings" class="chip chip--danger">{{ l.findings }} findings</span>
                <span v-if="l.unreviewed" class="chip chip--muted">{{ l.unreviewed }} unreviewed</span>
                <span v-if="l.staged" class="chip chip--info">{{ l.staged }} staged</span>
                <span v-if="!l.findings && l.done === l.total" class="chip chip--success">clean</span>
              </template>
            </td>
            <td class="muted">{{ lastRunLabel(l) }}</td>
            <td class="langrow__go"><Icon name="ChevRight" :size="14" /></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!langs.length" class="muted" style="padding: 18px">No language matches the filter.</p>
    </div>

    <!-- ── d2: master-detail ──────────────────────────────────────────── -->
    <div v-else-if="ui.design === 2" class="md">
      <div class="md__list">
        <button
          v-for="l in langs" :key="l.code"
          class="md__row" :class="{ active: active?.code === l.code }"
          @click="activeLang = l.code"
        >
          <span class="md__name"><b>{{ nameOf(l.code) }}</b> <span class="mono muted">{{ l.code }}</span></span>
          <span class="bar bar--mini"><i :style="{ width: pct(l) + '%' }" /></span>
          <span v-if="l.findings" class="chip chip--danger">{{ l.findings }}</span>
          <span v-else-if="l.done === l.total && l.done" class="chip chip--success">✓</span>
        </button>
        <p v-if="!langs.length" class="muted" style="padding: 12px">No language matches.</p>
      </div>
      <div v-if="active" class="md__detail">
        <h2>{{ nameOf(active.code) }} <span class="mono muted">{{ active.code }}</span></h2>
        <div class="statgrid">
          <div><b>{{ active.done.toLocaleString() }} / {{ active.total.toLocaleString() }}</b><span>translated</span></div>
          <div :class="{ danger: active.findings }"><b>{{ active.findings }}</b><span>findings</span></div>
          <div><b>{{ active.unreviewed }}</b><span>unreviewed</span></div>
          <div><b>{{ active.accepted }}</b><span>accepted</span></div>
          <div><b>{{ active.staged }}</b><span>staged</span></div>
        </div>
        <div class="bar" style="margin: 10px 0 16px">
          <i :class="{ full: active.done === active.total && !active.findings }"
             :style="{ width: pct(active) + '%' }" />
        </div>
        <div class="row">
          <UiButton
            intent="primary" :label="running ? 'Running…' : 'Translate pending'"
            :disabled="running" @click="translate([active.code])"
          />
          <UiButton intent="secondary" label="Review ›" @click="openReview(active.code)" />
        </div>
        <p class="muted" style="margin-top: 14px">
          Last run: {{ lastRunLabel(active) }}
          <template v-if="active.lastRun"> · {{ active.lastRun.keys }} keys ·
            {{ active.lastRun.failed ? `${active.lastRun.failed} failed` : "ok" }}</template>
        </p>
      </div>
    </div>

    <!-- ── d3: card grid ──────────────────────────────────────────────── -->
    <div v-else class="dash__scroll">
      <div class="cardgrid">
        <div v-for="l in langs" :key="l.code" class="langcard" @click="openReview(l.code)">
          <div class="langcard__head">
            <b>{{ nameOf(l.code) }}</b><span class="mono muted">{{ l.code }}</span>
          </div>
          <div class="bar"><i :class="{ full: l.done === l.total && !l.findings }"
                              :style="{ width: pct(l) + '%' }" /></div>
          <div class="langcard__meta">
            <span class="mono muted">{{ l.done.toLocaleString() }}/{{ l.total.toLocaleString() }}</span>
            <span v-if="l.findings" class="chip chip--danger">{{ l.findings }}</span>
            <span v-else-if="l.done === l.total && l.done" class="chip chip--success">clean</span>
            <span v-else-if="!l.done" class="chip chip--muted">todo</span>
          </div>
          <div class="langcard__actions" @click.stop>
            <UiButton
              intent="secondary" size="small" label="Translate"
              :disabled="running" @click="translate([l.code])"
            />
            <UiButton intent="ghost" size="small" label="Review ›" @click="openReview(l.code)" />
          </div>
        </div>
      </div>
      <p v-if="!langs.length" class="muted" style="padding: 18px">No language matches the filter.</p>
    </div>
  </div>
</template>
