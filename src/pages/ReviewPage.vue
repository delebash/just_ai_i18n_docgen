<script setup>
// SPDX-License-Identifier: MIT
// The review workspace — the ORIGINAL's tested shape, ported whole (Batch 3,
// 2026-08-05; detail source: just-ai-help client/src — App.vue's keyboard,
// QueuePane's buckets, KeyList's windowed terse rows, DetailPane's panels).
//
// Three panes: the queue rail (buckets with live counts + per-check breakdown +
// search), the windowed list (a row's job is only to let you move), and the
// detail pane (where reviewing actually happens). Keys are not a garnish: a
// reviewer works a couple of hundred items, and doing that with a mouse is the
// difference between a tool people use and one they abandon.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  EmptyState, PaneHeader, UiButton, UiCheckbox, UiInput, UiSelect, UiTag,
  UiTextarea, confirmDialog, otherWindows, pushToast, serverUrl,
} from "@delebash/ui";
import { useRoute } from "vue-router";
import { langName, langOptions } from "../services/langs";
import { useProjectStore } from "../stores/project";
import { BUCKETS, useReviewStore } from "../stores/review";
import { pageFlow } from "@delebash/ui";

const project = useProjectStore();
const review = useReviewStore();
const route = useRoute();
const { t } = useI18n();
const draft = ref("");
const noteDraft = ref("");
const busy = ref(false);
const showGoogle = ref(false);
const backBusy = ref(false);
const scroller = ref(null);

/** Plain words for the check codes (their keys). A code alone tells a reviewer nothing. */
const WHY_KEYS = {
  "spurious-interrogative": "review.why.spuriousInterrogative",
  startpunc: "review.why.startpunc",
  endpunc: "review.why.endpunc",
  untranslated: "review.why.untranslated",
  "placeholder-changed": "review.why.placeholderChanged",
  "plural-halves-lost": "review.why.pluralHalvesLost",
  "plural-halves-identical": "review.why.pluralHalvesIdentical",
  "glossary-translated": "review.why.glossaryTranslated",
  blank: "review.why.blank",
  missing: "review.why.missing",
  disagreement: "review.why.disagreement",
  terminology: "review.why.terminology",
  // its detail is the English the translation was made from
  "source-changed": "review.why.sourceChanged",
};

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
  const wanted = typeof route.query.lang === "string" ? route.query.lang : null;
  await review.refresh(wanted ?? review.lang ?? busiestLang() ?? project.langs[0] ?? null);
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
// Another window's change (the kit's otherWindows — it waits while the cursor is in a text box): the queue reads
// again in place, on the same language.
watch(() => otherWindows.changes, () => review.refresh());

// ── the keyboard (the original's App.vue map, page-local here) ─────────────
/** True when the user is typing, so j/k do not steal characters out of a box. */
const editing = () => {
  const el = document.activeElement;
  return el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
};
function onKey(e) {
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undoLast();
    }
    return;
  }
  if (editing()) {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  const go = {
    j: () => review.move(1),
    k: () => review.move(-1),
    ArrowDown: () => review.move(1),
    ArrowUp: () => review.move(-1),
    a: () => acceptActive(),
    u: () => undoLast(),
    e: () => document.querySelector(".review-detail textarea")?.focus(),
    g: () => { showGoogle.value = !showGoogle.value; },
    b: () => backtranslate(),
    "/": () => document.querySelector(".review-search input")?.focus(),
  }[e.key];
  if (go) {
    e.preventDefault();
    go();
  }
}

// Seed the editors when the SELECTED KEY changes — never on row identity.
// Watching activeRow reseeded on every background refresh (each save/accept
// replaces the rows array), wiping a draft mid-typing (audit 2026-08-05).
watch(() => review.activeKey, async () => {
  const row = review.activeRow;
  draft.value = row?.target ?? "";
  noteDraft.value = row?.note ?? "";
  showGoogle.value = false;
  // Keep the selected row on screen when the keyboard moves it past an edge.
  await nextTick();
  scroller.value?.querySelector(".rrow.on")?.scrollIntoView({ block: "nearest" });
});

// ── the windowed list (2,039 keys of DOM makes j/k stutter) ────────────────
const ROW = 32;
const OVER = 12;
const startRow = ref(0);
const listHeight = ref(600);
const windowed = computed(() => {
  const n = Math.ceil(listHeight.value / ROW) + OVER * 2;
  const from = Math.max(0, startRow.value - OVER);
  return { from, items: review.visible.slice(from, from + n) };
});
function onScroll(e) {
  startRow.value = Math.floor(e.target.scrollTop / ROW);
  listHeight.value = e.target.clientHeight;
}
/** What the confirmation pass thought about a row — an annotation, never a decision. */
const verdictOf = (r) => r.flags.find((f) => f.confirmed)?.confirmed ?? null;
const allPicked = computed(
  () => review.visible.length > 0 && review.pickedRows.length === review.visible.length,
);
const confirmedCount = computed(
  () => review.visible.filter((r) => r.flags.some((f) => f.confirmed === "same")).length,
);

// ── per-check breakdown for the CURRENT bucket (never an empty filter) ─────
const codesInBucket = computed(() => {
  const b = BUCKETS.find((x) => x.id === review.bucket);
  const n = {};
  for (const r of review.rows) {
    if (b && !b.match(r)) continue;
    for (const f of r.flags) n[f.code] = (n[f.code] ?? 0) + 1;
  }
  return Object.entries(n).sort((a, b2) => b2[1] - a[1]);
});

const hard = computed(() => (review.activeRow?.flags ?? []).filter((f) => !f.advisory));
const soft = computed(() => (review.activeRow?.flags ?? []).filter((f) => f.advisory));
/** Placeholders marked, so what must survive translation is impossible to miss. */
const marked = computed(() => {
  const t = review.activeRow?.source ?? "";
  return t.split(/(\{[^}]*\})/g).map((part, i) => ({ part, ph: i % 2 === 1 }));
});
const activeProposal = computed(
  () => review.staged.find((p) => p.key === review.activeKey) || null,
);
/** The Google second-opinion page the server crops (the /v1/gt-frame route). */
const gtSrc = computed(() => {
  const r = review.activeRow;
  if (!r) return "";
  return serverUrl(`/v1/gt-frame?text=${encodeURIComponent(r.source)}&tl=${encodeURIComponent(r.lang)}`);
});

const queueEmptyMessage = computed(() => {
  if (review.search || review.code) return t("review.emptySearch");
  if (review.staged.length)
    return t("review.emptyStaged", { n: review.staged.length }, review.staged.length);
  if (!review.lang) return t("review.emptyNoLang");
  return t("review.emptyGreen", { lang: langName(review.lang) });
});

// Every mutation says when it FAILED — a server error must never read as a no-op.
function toastFail(title) {
  return (e) => pushToast({ kind: "error", title, description: String(e?.message || e) });
}
async function saveDraft() {
  const row = review.activeRow;
  if (!row || draft.value === row.target) return;
  try {
    const out = await review.save(row, draft.value);
    pushToast(out.flags.length
      ? { kind: "info", title: t("review.savedFlagged"), description: out.flags.map((f) => f.code).join(", ") }
      : { kind: "success", title: t("review.savedClean") });
  } catch (e) { toastFail(t("review.saveFailed"))(e); }
}
async function acceptActive() {
  const row = review.activeRow;
  if (!row) return;
  try {
    await review.accept(row);
    pushToast({ kind: "success", title: t("review.accepted"), description: row.key });
  } catch (e) { toastFail(t("review.acceptFailed"))(e); }
}
async function acceptPicked() {
  try {
    const out = await review.acceptPicked();
    pushToast({ kind: "success", title: t("review.acceptedN", { n: out.recorded }, out.recorded),
                description: t("review.oneUndo") });
  } catch (e) { toastFail(t("review.acceptFailed"))(e); }
}
const unacceptActive = () =>
  review.unaccept(review.activeRow.lang, review.activeRow.key).catch(toastFail(t("review.unacceptFailed")));
const unacceptEntry = (entry) =>
  review.unaccept(review.lang, entry.key).catch(toastFail(t("review.unacceptFailed")));
const applyProposalActive = () =>
  review.applyProposal(review.activeRow).catch(toastFail(t("review.applyFailed")));
const discardProposalActive = () =>
  review.discardProposal(review.activeRow).catch(toastFail(t("review.discardFailed")));
const undoLast = () => review.undo().catch(toastFail(t("review.nothingUndone")));
async function saveNote() {
  try {
    await review.setNote(review.activeRow, noteDraft.value);
    pushToast({ kind: "success", title: t("review.noteSaved"),
                description: t("review.noteSavedBody") });
  } catch (e) { toastFail(t("review.noteFailed"))(e); }
}
async function backtranslate() {
  if (!review.activeRow || backBusy.value) return;
  backBusy.value = true;
  try {
    await review.backtranslate(review.activeRow);
  } catch (e) {
    toastFail(t("review.backFailed"))(e);
  } finally {
    backBusy.value = false;
  }
}
/** Takes the staged value into the box — never applied automatically. */
function useProposal() {
  if (activeProposal.value) draft.value = activeProposal.value.value;
}

// ── the staged pile ────────────────────────────────────────────────────────
async function applyAll() {
  const n = review.staged.length;
  if (!n || busy.value) return;
  const ok = await confirmDialog({
    title: t("review.applyTitle", { n, lang: langName(review.lang) }, n),
    message: t("review.applyMessage", { file: `${review.lang}.json` }),
    confirmLabel: t("review.applyConfirm", { n }),
  });
  if (!ok) return;
  busy.value = true;
  try {
    const out = await review.applyAllStaged();
    pushToast({ kind: "success", title: t("review.appliedTo", { n: out.applied.length, file: `${review.lang}.json` }),
                description: t("review.appliedBody") });
  } catch (e) { toastFail(t("review.applyFailed"))(e); } finally { busy.value = false; }
}
async function discardAll() {
  const n = review.staged.length;
  if (!n || busy.value) return;
  const ok = await confirmDialog({
    title: t("review.discardTitle", { n }, n),
    message: t("review.discardMessage"),
    confirmLabel: t("review.discardConfirm"),
  });
  if (!ok) return;
  busy.value = true;
  try {
    await review.discardAllStaged();
    pushToast({ kind: "info", title: t("review.discarded", { n }, n) });
  } catch (e) { toastFail(t("review.discardFailed"))(e); } finally { busy.value = false; }
}
</script>

<template>
  <!-- Column wrap so the family header (kit PaneHeader — parity batch
       2026-08-06) sits above the full-height rail+detail layout. -->
  <q-page :style-fn="pageFlow" class="review-pane">
  <PaneHeader :eyebrow="t('common.translating')" :title="t('nav.review')" help-key="review" />
  <div class="review">
    <!-- ── the queue rail: buckets · by check · search (the original's QueuePane) ── -->
    <nav class="review-rail">
      <div class="review-head" style="margin-bottom: 8px">
        <UiSelect v-model="review.lang" :options="langChoices" width="id"
                  @update:model-value="(l) => review.refresh(l)" />
      </div>
      <h3>{{ t("review.queue") }}</h3>
      <button
        v-for="b in BUCKETS" :key="b.id" class="bucket"
        :class="{ on: review.bucket === b.id && !review.code }"
        @click="review.pickBucket(b.id)"
      >
        {{ t(b.labelKey) }}
        <span class="n">{{ review.bucketCounts[b.id] ?? 0 }}</span>
      </button>
      <!-- The Accepted surface: accepted rows never reach the queue (the acceptance
           filter removes them), so WITHOUT this list "unaccept" had no door — the
           audit's guaranteed no-op. -->
      <button class="bucket" :class="{ on: review.bucket === 'accepted' }"
              @click="review.pickBucket('accepted')">
        {{ t("review.bucket.accepted") }}
        <span class="n">{{ review.accepted }}</span>
      </button>

      <template v-if="review.bucket !== 'accepted' && codesInBucket.length">
        <h3>{{ t("review.byCheck") }}</h3>
        <button
          v-for="[c, n] in codesInBucket" :key="c" class="bucket"
          :class="{ on: review.code === c }"
          @click="review.pickCode(c)"
        >
          {{ c }}
          <span class="n">{{ n }}</span>
        </button>
      </template>

      <h3>{{ t("review.search") }}</h3>
      <div style="padding: 0 6px">
        <UiInput v-model="review.search" class="review-search" :placeholder="t('review.searchPlaceholder')" />
      </div>
      <div style="padding: 6px">
        <UiButton intent="ghost" size="small" :label="t('review.undoLast')" @click="undoLast" />
      </div>
    </nav>

    <!-- ── the list: terse windowed rows — a row's job is only to let you move ── -->
    <div class="review-list">
      <!-- The staged pile: what the run produced and has NOT been written yet. -->
      <div v-if="review.staged.length && review.bucket !== 'accepted'" class="staged">
        <div>
          <b>{{ t("review.ready", { n: review.staged.length }, review.staged.length) }}</b>
          <span class="muted">{{ t("review.readyNote", { file: `${review.lang}.json` }) }}</span>
        </div>
        <div class="row" style="margin-top: 8px">
          <UiButton intent="primary" size="small" :disabled="busy"
                    :label="t('review.applyAll', { n: review.staged.length })" @click="applyAll" />
          <UiButton intent="ghost" size="small" :disabled="busy" :label="t('review.discardConfirm')" @click="discardAll" />
        </div>
      </div>

      <!-- The identical bucket's bulk bar: the confirmation pass SORTS the pile;
           the ticks are a suggested selection and the approval recorded is YOURS. -->
      <div v-if="review.bucket === 'identical' && review.visible.length" class="bulkbar">
        <UiCheckbox
          :model-value="allPicked"
          :label="review.pickedRows.length
            ? t('review.tickedOf', { picked: review.pickedRows.length, total: review.visible.length })
            : t('review.selectAllN', { n: review.visible.length })"
          @update:model-value="review.pickAll($event)"
        />
        <span class="spacer" />
        <UiButton v-if="confirmedCount" intent="secondary" size="small"
                  :label="t('review.tickConfirmed', { n: confirmedCount })"
                  @click="review.pickConfirmed()" />
        <UiButton intent="primary" size="small" :disabled="!review.pickedRows.length"
                  :label="t('review.approve', { n: review.pickedRows.length || '' })" @click="acceptPicked" />
      </div>

      <!-- The Accepted list (bucket 'accepted'): every recorded verdict, revisitable. -->
      <div v-if="review.bucket === 'accepted'" class="review-rows" style="overflow: auto">
        <div v-for="a in review.acceptedEntries" :key="a.key + a.code" class="acceptedrow">
          <div>
            <span class="k mono">{{ a.key }}</span>
            <UiTag intent="success" :value="a.code" />
            <span class="muted">{{ t("review.by", { name: a.by }) }}</span>
          </div>
          <UiButton intent="ghost" size="small" :label="t('review.unaccept')" @click="unacceptEntry(a)" />
        </div>
        <EmptyState v-if="!review.acceptedEntries.length" compact icon="CheckSquare"
                    :message="t('review.nothingAccepted')" />
      </div>

      <div v-else ref="scroller" class="review-rows" @scroll="onScroll">
        <EmptyState v-if="!review.visible.length" compact icon="CheckSquare" :message="queueEmptyMessage" />
        <div v-else :style="{ height: `${review.visible.length * ROW}px`, position: 'relative' }">
          <div :style="{ transform: `translateY(${windowed.from * ROW}px)` }">
            <div
              v-for="r in windowed.items" :key="r.lang + r.key"
              class="rrow"
              :class="{ on: r.key === review.activeKey, done: r.status === 'reviewed' }"
              :style="{ height: `${ROW}px` }"
              @click="review.open(r.key)"
            >
              <UiCheckbox
                v-if="review.bucket === 'identical'"
                :model-value="review.isPicked(r.key)"
                @click.stop
                @update:model-value="review.togglePick(r.key)"
              />
              <span class="k">{{ r.key }}</span>
              <span v-if="verdictOf(r)" class="verdict" :class="verdictOf(r)">
                {{ verdictOf(r) === "same" ? t("review.verdictSame") : t("review.verdictSkipped") }}
              </span>
              <span class="dots">
                <i v-for="(f, i) in r.flags.slice(0, 4)" :key="i" class="dot"
                   :class="{ advisory: f.advisory }" :title="f.code" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── the detail pane — where the reviewing actually happens ── -->
    <div class="review-detail" v-if="review.activeRow && review.bucket !== 'accepted'">
      <div class="card">
        <h2 class="mono" style="font-size: 13px">{{ review.activeRow.key }}</h2>
        <p class="hint">
          {{ review.activeRow.lang }} ·
          {{ review.activeRow.key.split('.').slice(0, -1).join(' › ') || t('review.root') }}
        </p>
        <!-- why is this flagged — the code, plus what the check looks for in plain English -->
        <div v-if="review.activeRow.flags.length" style="margin-bottom: 8px">
          <div v-for="(f, i) in hard" :key="`h${i}`" class="finding">
            <span class="code">{{ f.code }}</span>{{ WHY_KEYS[f.code] ? t(WHY_KEYS[f.code], { was: f.detail }) : f.detail }}
          </div>
          <div v-for="(f, i) in soft" :key="`s${i}`" class="finding advisory">
            <span class="code">{{ f.code }}</span>{{ f.detail }}
            <template v-if="f.confirmed">
              <br /><span class="muted">{{ t("review.engineSays", { verdict: f.confirmed === 'same' ? t('review.engineSame') : t('review.engineSkipped') }) }}
              <template v-if="f.suggestion">{{ t("review.engineSuggests", { suggestion: f.suggestion }) }}</template>
              ({{ f.confirmedBy }})</span>
            </template>
          </div>
        </div>
        <!-- source with placeholders marked, so what must survive is visible -->
        <div class="srcbox">
          <template v-for="(m, i) in marked" :key="i">
            <mark v-if="m.ph">{{ m.part }}</mark><template v-else>{{ m.part }}</template>
          </template>
        </div>
        <UiTextarea v-model="draft" class="detail-text" />
        <div class="row" style="margin-top: 8px">
          <UiButton intent="primary" :label="t('review.save')" @click="saveDraft" />
          <UiButton intent="secondary" :label="t('review.acceptAsCorrect')" :title="t('review.shortcut', { key: 'a' })" @click="acceptActive" />
          <UiButton intent="ghost" :label="t('review.unacceptButton')" @click="unacceptActive" />
          <UiButton intent="ghost" :label="t('review.skip')" :title="t('review.shortcut', { key: 'j' })" @click="review.move(1)" />
        </div>
      </div>

      <!-- what a run proposed — never applied by anyone but you -->
      <div class="card" v-if="activeProposal">
        <h2>{{ t("review.proposedBy", { engine: activeProposal.engine }) }}</h2>
        <div class="srcbox">{{ activeProposal.value }}</div>
        <div class="row" style="margin-top: 8px">
          <UiButton intent="secondary" size="small" :label="t('review.useThis')" @click="useProposal" />
          <UiButton intent="primary" size="small" :label="t('common.apply')" @click="applyProposalActive" />
          <UiButton intent="ghost" size="small" :label="t('common.discard')" @click="discardProposalActive" />
        </div>
      </div>

      <!-- the Google second opinion (g) — an iframe over the server's /v1/gt-frame crop -->
      <div class="card">
        <div class="row">
          <h2 style="margin: 0">{{ t("review.googleTitle") }}</h2>
          <span class="spacer" />
          <UiButton intent="ghost" size="small" :label="showGoogle ? t('review.hide') : t('review.show')" :title="t('review.shortcut', { key: 'g' })"
                    @click="showGoogle = !showGoogle" />
        </div>
        <div v-if="showGoogle" class="gtclip">
          <iframe :src="gtSrc" :title="t('review.googleFrame')" />
        </div>
        <p v-else class="hint" style="margin: 6px 0 0">{{ t("review.googleHint") }}</p>
      </div>

      <!-- what it says in English (b) -->
      <div class="card">
        <div class="row">
          <h2 style="margin: 0">{{ t("review.englishTitle") }}</h2>
          <span class="spacer" />
          <UiButton intent="ghost" size="small" :label="review.detail?.english ? t('review.again') : t('review.readBack')"
                    :title="t('review.shortcut', { key: 'b' })" :disabled="backBusy" @click="backtranslate" />
        </div>
        <p :class="review.detail?.english ? '' : 'hint'" style="margin: 6px 0 0">
          {{ review.detail?.english || t("review.englishHint") }}
        </p>
      </div>

      <div class="card" v-if="review.detail?.siblings?.length">
        <h2>{{ t("review.siblings") }}</h2>
        <p class="hint">{{ t("review.siblingsHint") }}</p>
        <div v-for="s in review.detail.siblings" :key="s.key" class="sib">
          <span>{{ s.source }}</span><span>{{ s.target }}</span>
        </div>
      </div>

      <div class="card">
        <h2>{{ t("review.noteTitle") }}</h2>
        <p class="hint">{{ t("review.noteHint") }}</p>
        <div class="row">
          <UiTextarea v-model="noteDraft" class="detail-text" style="min-height: 40px"
                      :placeholder="t('review.notePlaceholder')" />
        </div>
        <div class="row" style="margin-top: 8px">
          <UiButton intent="secondary" :label="t('review.saveNote')" @click="saveNote" />
        </div>
      </div>
    </div>
    <div class="review-detail" v-else-if="review.bucket !== 'accepted'">
      <EmptyState icon="CheckSquare" :title="t('review.nothingSelected')"
                  :message="review.visible.length ? t('review.pickKey') : queueEmptyMessage" />
    </div>
    <div class="review-detail" v-else>
      <EmptyState icon="CheckSquare" :title="t('review.acceptedTitle')"
                  :message="t('review.acceptedBody')" />
    </div>
  </div>
  </q-page>
</template>
