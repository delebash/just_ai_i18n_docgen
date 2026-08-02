<script setup>
// SPDX-License-Identifier: MIT
// The review queue: rows on the left, the active key's detail on the right. Everything
// here maps 1:1 to the API's promises — bulk accept is ONE undo, unaccept can revisit,
// a save re-checks the key immediately, the confirmation pass PRE-TICKS but never
// signs off, and a suggestion is shown, never applied by anyone but you.
import { computed, onMounted, ref, watch } from "vue";
import { UiButton, UiSelect, pushToast } from "@delebash/llm-ui";
import { useRoute } from "vue-router";
import { useProjectStore } from "../stores/project";
import { useReviewStore } from "../stores/review";

const project = useProjectStore();
const review = useReviewStore();
const route = useRoute();
const draft = ref("");
const noteDraft = ref("");
const filter = ref(null);

onMounted(async () => {
  await project.refresh();
  // The dashboard's row click lands here with ?lang= — honour it.
  const wanted = typeof route.query.lang === "string" ? route.query.lang : null;
  await review.refresh(wanted ?? review.lang ?? project.langs[0] ?? null);
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
</script>

<template>
  <div class="review">
    <div class="review-list">
      <div class="row" style="margin-bottom: 8px">
        <UiSelect v-model="review.lang" :options="project.langs" width="token"
                  @update:model-value="(l) => review.refresh(l)" />
        <UiSelect v-model="filter" :options="codes" placeholder="all flags"
                  show-clear width="id" />
        <span class="spacer" />
        <UiButton intent="ghost" label="Undo" @click="review.undo()" />
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
          Nothing to review — the gate is green.
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
      <div class="card"><p class="muted">Pick a key from the queue.</p></div>
    </div>
  </div>
</template>
