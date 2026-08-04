<script setup>
// SPDX-License-Identifier: MIT
// The review queue: rows on the left, the active key's detail on the right. Everything
// here maps 1:1 to the API's promises — bulk accept is ONE undo, unaccept can revisit,
// a save re-checks the key immediately, the confirmation pass PRE-TICKS but never
// signs off, and a suggestion is shown, never applied by anyone but you.
import { computed, onMounted, ref, watch } from "vue";
import { UiButton, UiSelect, confirmDialog, pushToast } from "@delebash/llm-ui";
import { useRoute } from "vue-router";
import { langName, langOptions } from "../services/langs";
import { useProjectStore } from "../stores/project";
import { useReviewStore } from "../stores/review";

const project = useProjectStore();
const review = useReviewStore();
const route = useRoute();
const draft = ref("");
const noteDraft = ref("");
const filter = ref(null);
const busy = ref(false);

// The picker says which languages have work, and how much — this page IS the work, so
// "es" and "fr" alone made you open each one to find out where it was.
const langChoices = computed(() =>
  langOptions(project.langs, (code) => {
    const l = (project.summary?.langs || []).find((x) => x.code === code);
    return l ? l.staged + l.unreviewed : 0;
  }),
);
// Where the work IS. Landing on the config's first language put you on a clean queue
// while another language had a whole run staged (the fr row, 2026-08-03).
function busiestLang() {
  const rows = [...(project.summary?.langs || [])]
    .sort((a, b) => (b.staged + b.unreviewed) - (a.staged + a.unreviewed));
  return rows.find((l) => l.staged + l.unreviewed > 0)?.code || null;
}

onMounted(async () => {
  await Promise.all([project.refresh(), project.fetchSummary()]);
  // The dashboard's row click lands here with ?lang= — honour it; otherwise open where
  // there is something to do, and only then fall back to the first language.
  const wanted = typeof route.query.lang === "string" ? route.query.lang : null;
  await review.refresh(wanted ?? review.lang ?? busiestLang() ?? project.langs[0] ?? null);
});

watch(() => review.activeRow, (row) => {
  draft.value = row?.target ?? "";
  noteDraft.value = row?.note ?? "";
});

const filtered = computed(() => {
  if (!filter.value) return review.rows;
  return review.rows.filter((r) => r.flags.some((f) => f.code === filter.value));
});
const codes = computed(() => Object.keys(review.counts).sort());

// The obvious bulk action: every row whose ONLY flags are confirmed-same
// untranslated findings — the pile the confirmation pass pre-ticked.
const preTicked = computed(() =>
  review.rows.filter((r) =>
    r.flags.length && r.flags.every((f) => f.code === "untranslated" && f.confirmed === "same"))
);

async function saveDraft() {
  const out = await review.save(review.activeRow, draft.value);
  pushToast(out.flags.length
    ? { kind: "info", title: "Saved — still flagged", description: out.flags.map((f) => f.code).join(", ") }
    : { kind: "success", title: "Saved, checks clean" });
}
async function acceptBulk() {
  const out = await review.acceptMany(review.lang, preTicked.value.map((r) => r.key));
  pushToast({ kind: "success", title: `${out.recorded} finding(s) accepted`,
              description: "One click, one undo." });
}
async function backtranslate() {
  try {
    await review.backtranslate(review.activeRow);
  } catch (e) {
    pushToast({ kind: "error", title: "Back-translation failed", description: String(e?.message || e) });
  }
}

// ── the staged pile ────────────────────────────────────────────────────────
// A run NEVER writes locale files; it stages a proposal per key. Applying them was
// one key at a time, so a 1,965-key run meant 1,965 clicks — while the server has
// taken a keys[] array all along. This is the button that finishes a run.
async function applyAll() {
  const n = review.staged.length;
  if (!n || busy.value) return;
  const ok = await confirmDialog({
    title: `Apply ${n} translation${n === 1 ? "" : "s"} to ${langName(review.lang)}?`,
    message: `This writes ${review.lang}.json — the first time anything in this run touches your locale file. It is one Undo if it looks wrong.`,
    confirmLabel: `Apply ${n}`,
  });
  if (!ok) return;
  busy.value = true;
  try {
    const out = await review.applyAllStaged();
    pushToast({ kind: "success", title: `${out.applied.length} applied to ${review.lang}.json`,
                description: "One click, one Undo — the checks re-ran on what was written." });
  } catch (e) {
    pushToast({ kind: "error", title: "Apply failed", description: String(e?.message || e) });
  } finally {
    busy.value = false;
  }
}
async function discardAll() {
  const n = review.staged.length;
  if (!n || busy.value) return;
  const ok = await confirmDialog({
    title: `Discard ${n} staged translation${n === 1 ? "" : "s"}?`,
    message: "The run's output is thrown away. Your locale file is untouched — nothing was written yet — and re-running translates them again.",
    confirmLabel: "Discard them",
  });
  if (!ok) return;
  busy.value = true;
  try {
    await review.discardAllStaged();
    pushToast({ kind: "info", title: `${n} staged translation(s) discarded` });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="review">
    <div class="review-list">
      <!-- One line, not wrapped: `.row` wraps by default and pushed Undo onto a line of
           its own under the pickers. -->
      <div class="row review-head" style="margin-bottom: 8px">
        <UiSelect v-model="review.lang" :options="langChoices" width="id"
                  @update:model-value="(l) => review.refresh(l)" />
        <!-- The flag filter only exists when there ARE flags to filter — an empty
             dropdown beside an empty queue read as a broken control. -->
        <UiSelect v-if="codes.length" v-model="filter" :options="codes"
                  placeholder="all flags" show-clear width="id" />
        <span class="spacer" />
        <UiButton intent="ghost" label="Undo" @click="review.undo()" />
      </div>

      <!-- The staged pile: what the run produced and has NOT been written yet. This is
           the step between "translated" and "in your app", and it was reachable only
           one key at a time. -->
      <div v-if="review.staged.length" class="staged">
        <div>
          <b>{{ review.staged.length }} translation{{ review.staged.length === 1 ? "" : "s" }} ready</b>
          <span class="muted"> — staged by the last run; your {{ review.lang }}.json is untouched so far.</span>
        </div>
        <div class="row" style="margin-top: 8px">
          <UiButton intent="primary" size="small" :disabled="busy"
                    :label="`Apply all ${review.staged.length}`" @click="applyAll" />
          <UiButton intent="ghost" size="small" :disabled="busy" label="Discard them" @click="discardAll" />
        </div>
      </div>

      <div class="row" style="margin-bottom: 8px; font-size: 12px" v-if="review.total">
        <span class="muted">{{ review.total }} to review · {{ review.accepted }} accepted</span>
        <span class="spacer" />
        <UiButton v-if="preTicked.length" intent="secondary" size="small"
                  :label="`Accept ${preTicked.length} pre-ticked`" @click="acceptBulk" />
      </div>
      <div class="review-rows">
        <div
          v-for="r in filtered" :key="r.lang + r.key"
          class="rowitem" :class="{ active: r.key === review.activeKey }"
          @click="review.open(r.key)"
        >
          <div class="key">{{ r.key }}</div>
          <div class="src">{{ r.source }}</div>
          <div class="flagchips">
            <span
              v-for="f in r.flags" :key="f.code + (f.detail || '')"
              class="flagchip"
              :class="{ advisory: f.advisory, confirmed: f.confirmed === 'same' }"
            >{{ f.code }}<template v-if="f.confirmed === 'same'"> ✓</template></span>
            <span v-if="r.hasProposal" class="flagchip advisory">proposal</span>
            <span v-if="r.note" class="flagchip advisory">note</span>
          </div>
        </div>
        <div v-if="!filtered.length" style="padding: 24px" class="muted">
          <template v-if="filter">No key carries the “{{ filter }}” flag.</template>
          <template v-else-if="review.staged.length">
            Nothing flagged — apply the {{ review.staged.length }} staged translation(s) above
            and the checks run on what gets written.
          </template>
          <template v-else>Nothing to review — the gate is green for {{ langName(review.lang) }}.</template>
        </div>
      </div>
    </div>

    <div class="review-detail" v-if="review.activeRow">
      <div class="card">
        <h2 class="mono" style="font-size: 13px">{{ review.activeRow.key }}</h2>
        <p class="hint">{{ review.activeRow.lang }} · source below, your translation under it</p>
        <div style="padding: 8px 10px; background: var(--surface-2); border-radius: 6px; margin-bottom: 8px">
          {{ review.activeRow.source }}
        </div>
        <textarea v-model="draft" class="detail-text" />
        <div class="row" style="margin-top: 8px">
          <UiButton intent="primary" label="Save" @click="saveDraft" />
          <UiButton intent="secondary" label="Accept as correct" @click="review.accept(review.activeRow)" />
          <UiButton v-if="review.activeRow.hasProposal" intent="secondary" label="Apply proposal"
                    @click="review.applyProposal(review.activeRow)" />
          <UiButton intent="ghost" label="Unaccept"
                    @click="review.unaccept(review.activeRow.lang, review.activeRow.key)" />
          <span class="spacer" />
          <UiButton intent="ghost" label="What does it say? (back-translate)" @click="backtranslate" />
        </div>
        <p v-if="review.detail?.english" style="margin: 10px 0 0">
          <span class="muted">reads back as:</span> “{{ review.detail.english }}”
        </p>
      </div>

      <div class="card" v-if="review.activeRow.flags.length">
        <h2>Findings</h2>
        <div v-for="f in review.activeRow.flags" :key="f.code + (f.detail || '')"
             class="finding" :class="{ advisory: f.advisory }">
          <span class="code">{{ f.code }}</span>{{ f.detail }}
          <template v-if="f.confirmed">
            <br /><span class="muted">engine says: {{ f.confirmed === 'same' ? 'correct as-is' : 'looks skipped' }}
            <template v-if="f.suggestion"> — suggests “{{ f.suggestion }}” (not applied)</template>
            ({{ f.confirmedBy }})</span>
          </template>
        </div>
      </div>

      <div class="card">
        <h2>Note for the next run</h2>
        <p class="hint">
          Sent WITH this key next time it translates — how "Why:" stops coming back as
          "¿Por qué?". Fix it once, it stays fixed.
        </p>
        <div class="row">
          <textarea v-model="noteDraft" class="detail-text" style="min-height: 40px"
                    placeholder="e.g. a label above a reasoning block, not a question" />
        </div>
        <div class="row" style="margin-top: 8px">
          <UiButton intent="secondary" label="Save note"
                    @click="review.setNote(review.activeRow, noteDraft)" />
        </div>
      </div>

      <div class="card" v-if="review.detail?.siblings?.length">
        <h2>Siblings</h2>
        <p class="hint">The same namespace — how the pattern is rendered next door.</p>
        <div v-for="s in review.detail.siblings" :key="s.key" class="sib">
          <span>{{ s.source }}</span><span>{{ s.target }}</span>
        </div>
      </div>
    </div>
    <div class="review-detail" v-else>
      <!-- "Pick a key from the queue" beside an EMPTY queue is an instruction you
           cannot follow — say what is actually true of this language instead. -->
      <div class="card">
        <p v-if="filtered.length" class="muted">Pick a key from the queue.</p>
        <template v-else-if="review.staged.length">
          <h2>{{ review.staged.length }} translation(s) waiting</h2>
          <p class="hint" style="margin: 0">
            The last run staged them; nothing is written to {{ review.lang }}.json until you
            apply. Use <b>Apply all</b> on the left, then review whatever the checks flag.
          </p>
        </template>
        <template v-else>
          <h2>{{ langName(review.lang) }} is clean</h2>
          <p class="hint" style="margin: 0">
            No findings, nothing staged. Translate more keys from Home, or pick another
            language above — the picker shows where the work is.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
