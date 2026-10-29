<script setup>
// SPDX-License-Identifier: MIT
// Home. With a project: the ruled dashboard (Design 1) — a language is a ROW in the
// kit's UiTable, so 3 or 40 languages is the same page; the header stays put, the
// table sorts/filters itself, and "Translate" runs scope=pending (missing ∪ flagged —
// the server owns that meaning). Without a project: a real welcome, not a bare
// button — the splash plate, the three steps, and the two ways in.
// The run strip is the kit's AiTaskStrip over the translate task the jobs store
// registers, found with the kit's useSurfaceTask — same surface as the AI-tasks panel, no
// bespoke strip; while it shows here the global stack leaves the task out (app-structure §8).
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  AiTaskStrip, Icon, PaneHeader, UiButton, UiCheckbox, UiInput, UiProgress,
  UiTable, UiTag, otherWindows, reportError, usePoll, useSurfaceTask,
} from "@delebash/ui";
import splashPlate from "../assets/images/splash-plate.jpg";
import { langTitle } from "../services/langs";
import { useJobsStore } from "../stores/jobs";
import { useProjectStore } from "../stores/project";
import { pageFill } from "@delebash/ui";

const project = useProjectStore();
const jobs = useJobsStore();
const router = useRouter();
const { t, n, d } = useI18n();

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
  retry.start();
});

// Another window's change on this server (the kit's otherWindows — a translation saved, a run started): the counts
// and the run read again in place.
watch(() => otherWindows.changes, () => Promise.all([project.fetchSummary(), jobs.refresh()]));

// A finished run changes every count on this page — refetch when one settles.
watch(() => jobs.job?.state, async (state, prev) => {
  if (prev === "running" && state && state !== "running") await project.fetchSummary();
});

const running = computed(() => jobs.running);
const translateTask = useSurfaceTask("translate");
const rows = computed(() =>
  (project.summary?.langs ?? []).map((l) => ({ ...l, name: langTitle(l.code) })),
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
const columns = computed(() => [
  { id: "sel", header: "" },
  { id: "name", header: t("common.language"), accessorKey: "name", sortable: true },
  { id: "progress", header: t("home.colProgress"), accessorKey: "done", sortable: true },
  // "Status", not "Findings": the chips under it say "not yet translated" / "6 staged"
  // / "clean" as often as they say findings.
  { id: "findings", header: t("home.colStatus"), accessorKey: "findings", sortable: true },
  { id: "lastRun", header: t("home.colLastRun") },
  { id: "go", header: "" },
]);

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
    reportError(e);
  }
}
function lastRunLabel(l) {
  // the run's time in this computer's time zone and the interface's language (it showed UTC, sliced)
  return l.lastRun?.startedAt ? d(new Date(l.lastRun.startedAt), "dateTimeShort") : "—";
}
</script>

<template>
  <q-page :style-fn="pageFill">
    <!-- Server-down now shows the kit ConnectionError INSTEAD of the app (its own route,
         /offline — JW's pattern): a dead server breaks every view, not just Home. -->
    <!-- CONFIRMED no project (409): the welcome — what this is, and the two ways in. -->
    <div v-if="project.noProject" class="intro">
      <img class="intro__plate" :src="splashPlate" :alt="t('app.name')" />
      <div class="intro__steps">
        <div class="intro__step">
          <b>{{ t("home.intro.point") }}</b>
          <span>{{ t("home.intro.pointBody") }}</span>
        </div>
        <div class="intro__step">
          <b>{{ t("home.intro.translate") }}</b>
          <span>{{ t("home.intro.translateBody") }}</span>
        </div>
        <div class="intro__step">
          <b>{{ t("home.intro.review") }}</b>
          <span>{{ t("home.intro.reviewBody") }}</span>
        </div>
      </div>
      <!-- ONE door (ruling R3, 2026-08-04): the permanent "Set up local AI" button is
           retired — the once-ever kit AiSetupOffer (layouts/MainLayout.vue) owns first AI contact. -->
      <div class="row" style="justify-content: center; gap: 12px">
        <UiButton intent="primary" :label="t('home.openSetup')" @click="router.push('/setup')" />
      </div>
    </div>

    <!-- Server unreachable AFTER boot (the boot file's gate only covers boot): say so and
         keep retrying — a blank page reads as broken (audit 2026-08-05). -->
    <div v-else-if="project.serverDown" class="intro">
      <p class="muted" style="text-align: center">
        {{ t("home.serverDown") }}
      </p>
    </div>

    <div v-else-if="project.summary" class="dash">
      <!-- The family header shape (kit PaneHeader — parity batch 2026-08-06);
           the key-count line + status tags ride the actions slot. -->
      <PaneHeader :eyebrow="t('common.project')" :title="project.appName" help-key="getting-started">
        <i18n-t keypath="home.headSub" tag="p" class="page-sub head-sub" scope="global">
          <template #keys>{{ n(project.summary.keyCount) }}</template>
          <template #source><span class="mono">{{ project.summary.source }}</span></template>
          <template #langs>{{ t("home.langCount", { n: project.summary.langs.length }, project.summary.langs.length) }}</template>
        </i18n-t>
        <UiTag v-if="totals.findings" intent="danger" :value="t('home.findings', { n: totals.findings }, totals.findings)" />
        <UiTag v-if="totals.staged" intent="info" :value="t('home.staged', { n: totals.staged })" />
        <UiTag v-if="totals.accepted" intent="success" :value="t('home.accepted', { n: totals.accepted })" />
      </PaneHeader>

      <AiTaskStrip v-if="translateTask" class="dash__strip" :task="translateTask" />

      <div class="dash__tools">
        <UiInput v-model="filter" :placeholder="t('home.filter')" width="id" />
        <span class="spacer" />
        <router-link class="quiet-link" to="/runs">{{ t("home.advancedRuns") }}</router-link>
        <UiButton
          intent="primary"
          :label="running ? t('home.running') : selected.length ? t('home.translateN', { n: selected.length }) : t('common.translate')"
          :disabled="!selected.length || running"
          :title="t('home.translateHint')"
          @click="translate(selected)"
        />
      </div>

      <div class="dash__scroll">
        <UiTable
          :data="rows" :columns="columns" data-key="code"
          :global-filter="filter" :global-filter-fields="['name', 'code']"
          row-hover
        >
          <!-- Select-all belongs in the checkbox column's HEADER, above the boxes it
               controls — not in a strip under the table, which is where it sat until the
               kit's UiTable grew a head-<id> slot (2026-08-03). -->
          <template #head-sel>
            <span @click.stop>
              <UiCheckbox :model-value="allTicked" :title="t('home.selectAll')"
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
              <span class="mono muted">{{ n(row.done) }} / {{ n(row.total) }}</span>
            </span>
          </template>
          <template #findings="{ row }">
            <!-- A run STAGES proposals, it never writes the locale file — so done=0
                 with staged work is the first-run state, not "nothing happened"
                 ('not yet translated' beside a finished Last run read as a failed
                 run — the fr row, 2026-08-03). -->
            <UiTag v-if="row.done === 0 && !row.staged" intent="secondary" :value="t('home.notYetTranslated')" />
            <template v-else>
              <UiTag v-if="row.findings" intent="danger" :value="t('home.findings', { n: row.findings }, row.findings)" />
              <UiTag v-if="row.unreviewed" intent="secondary" :value="t('home.unreviewed', { n: row.unreviewed })" />
              <UiTag v-if="row.staged" intent="info" :value="t('home.staged', { n: row.staged })" />
              <UiTag v-if="!row.findings && row.done === row.total" intent="success" :value="t('home.clean')" />
            </template>
          </template>
          <template #lastRun="{ row }">
            <span class="muted">{{ lastRunLabel(row) }}</span>
          </template>
          <template #go="{ row }">
            <!-- the kit's icon button, named and with its tooltip (a hand-built button until 2026-10-29) -->
            <UiButton
              v-tooltip="t('nav.review')" intent="ghost" size="icon" :aria-label="t('nav.review')"
              @click="openReview(row.code)"
            >
              <template #icon><Icon name="ChevRight" :size="14" /></template>
            </UiButton>
          </template>
          <template #empty>
            <span class="muted">{{ t("home.noMatch") }}</span>
          </template>
        </UiTable>
      </div>
    </div>

    <!-- loading: the first summary on its way — never a blank page (app-structure §17) -->
    <q-inner-loading v-else showing :label="t('kit.common.loading')" />
  </q-page>
</template>
