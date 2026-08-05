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
import {
  EmptyState, UiButton, UiCheckbox, UiInput, UiSelect, UiTag, UiTextarea,
  confirmDialog, pushToast, serverUrl,
} from "@delebash/llm-ui";
import { useRoute } from "vue-router";
import { langName, langOptions } from "../services/langs";
import { useProjectStore } from "../stores/project";
import { BUCKETS, useReviewStore } from "../stores/review";

const project = useProjectStore();
const review = useReviewStore();
const route = useRoute();
const draft = ref("");
const noteDraft = ref("");
const busy = ref(false);
const showGoogle = ref(false);
const backBusy = ref(false);
const scroller = ref(null);

/** Plain-English for the check codes. A code alone tells a reviewer nothing. */
const WHY = {
  "spurious-interrogative": "the source is a statement, but the translation is a question",
  startpunc: "this language opens questions and exclamations with a paired mark — one is missing or unpaired",
  endpunc: "the source and the translation end with different punctuation",
  untranslated: "the translation is identical to the English",
  "placeholder-changed": "an interpolation like {count} was lost, changed or duplicated",
  "plural-halves-lost": "a plural form either side of | disappeared",
  "plural-halves-identical": "the two halves either side of | are the same, so the plural does nothing",
  "glossary-translated": "a do-not-translate term was translated",
  blank: "the translation is empty",
  missing: "this key has no translation at all",
  disagreement: "a second pass worded this differently — the model was unsure here",
  terminology: "this uses a different word than the rest of the catalogue does for the same term",
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
    "/": () => document.querySelector('input[placeholder^="key or text"]')?.focus(),
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
  if (review.search || review.code) return "Nothing here. Try another bucket, or clear the search.";
  if (review.staged.length)
    return `Nothing flagged — apply the ${review.staged.length} staged translation(s) above and the checks run on what gets written.`;
  if (!review.lang) return "Nothing to review yet.";
  return `Nothing to review — the gate is green for ${langName(review.lang)}.`;
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
      ? { kind: "info", title: "Saved — still flagged", description: out.flags.map((f) => f.code).join(", ") }
      : { kind: "success", title: "Saved, checks clean" });
  } catch (e) { toastFail("Save failed")(e); }
}
async function acceptActive() {
  const row = review.activeRow;
  if (!row) return;
  try {
    await review.accept(row);
    pushToast({ kind: "success", title: "Accepted as correct", description: row.key });
  } catch (e) { toastFail("Accept failed")(e); }
}
async function acceptPicked() {
  try {
    const out = await review.acceptPicked();
    pushToast({ kind: "success", title: `${out.recorded} finding(s) accepted`,
                description: "One click, one undo." });
  } catch (e) { toastFail("Accept failed")(e); }
}
const unacceptActive = () =>
  review.unaccept(review.activeRow.lang, review.activeRow.key).catch(toastFail("Unaccept failed"));
const unacceptEntry = (entry) =>
  review.unaccept(review.lang, entry.key).catch(toastFail("Unaccept failed"));
const applyProposalActive = () =>
  review.applyProposal(review.activeRow).catch(toastFail("Apply failed"));
const discardProposalActive = () =>
  review.discardProposal(review.activeRow).catch(toastFail("Discard failed"));
const undoLast = () => review.undo().catch(toastFail("Nothing undone"));
async function saveNote() {
  try {
    await review.setNote(review.activeRow, noteDraft.value);
    pushToast({ kind: "success", title: "Note saved",
                description: "It will be sent with this key on the next translation." });
  } catch (e) { toastFail("Note not saved")(e); }
}
async function backtranslate() {
  if (!review.activeRow || backBusy.value) return;
  backBusy.value = true;
  try {
    await review.backtranslate(review.activeRow);
  } catch (e) {
    toastFail("Back-translation failed")(e);
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
  } catch (e) { toastFail("Apply failed")(e); } finally { busy.value = false; }
}
async function discardAll() {
  const n = review.staged.length;
  if (!n || busy.value) return;
  const ok = await confirmDialog({
    title: `Discard ${n} staged translation${n === 1 ? "" : "s"}?`,
    message: "The run's output is thrown away. Your locale file is untouched — nothing was written yet — and re-running translates them again. One Undo brings the pile back.",
    confirmLabel: "Discard them",
  });
  if (!ok) return;
  busy.value = true;
  try {
    await review.discardAllStaged();
    pushToast({ kind: "info", title: `${n} staged translation(s) discarded` });
  } catch (e) { toastFail("Discard failed")(e); } finally { busy.value = false; }
}
</script>

<template>
  <div class="review">
    <!-- ── the queue rail: buckets · by check · search (the original's QueuePane) ── -->
    <nav class="review-rail">
      <div class="review-head" style="margin-bottom: 8px">
        <UiSelect v-model="review.lang" :options="langChoices" width="id"
                  @update:model-value="(l) => review.refresh(l)" />
      </div>
      <h3>Queue</h3>
      <button
        v-for="b in BUCKETS" :key="b.id" class="bucket"
        :class="{ on: review.bucket === b.id && !review.code }"
        @click="review.pickBucket(b.id)"
      >
        {{ b.label }}
        <span class="n">{{ review.bucketCounts[b.id] ?? 0 }}</span>
      </button>
      <!-- The Accepted surface: accepted rows never reach the queue (the acceptance
           filter removes them), so WITHOUT this list "unaccept" had no door — the
           audit's guaranteed no-op. -->
      <button class="bucket" :class="{ on: review.bucket === 'accepted' }"
              @click="review.pickBucket('accepted')">
        Accepted
        <span class="n">{{ review.accepted }}</span>
      </button>

      <template v-if="review.bucket !== 'accepted' && codesInBucket.length">
        <h3>By check</h3>
        <button
          v-for="[c, n] in codesInBucket" :key="c" class="bucket"
          :class="{ on: review.code === c }"
          @click="review.pickCode(c)"
        >
          {{ c }}
          <span class="n">{{ n }}</span>
        </button>
      </template>

      <h3>Search</h3>
      <div style="padding: 0 6px">
        <UiInput v-model="review.search" placeholder="key or text…" />
      </div>
      <div style="padding: 6px">
        <UiButton intent="ghost" size="small" label="Undo last (u)" @click="undoLast" />
      </div>
    </nav>

    <!-- ── the list: terse windowed rows — a row's job is only to let you move ── -->
    <div class="review-list">
      <!-- The staged pile: what the run produced and has NOT been written yet. -->
      <div v-if="review.staged.length && review.bucket !== 'accepted'" class="staged">
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

      <!-- The identical bucket's bulk bar: the confirmation pass SORTS the pile;
           the ticks are a suggested selection and the approval recorded is YOURS. -->
      <div v-if="review.bucket === 'identical' && review.visible.length" class="bulkbar">
        <UiCheckbox
          :model-value="allPicked"
          :label="review.pickedRows.length
            ? `${review.pickedRows.length} of ${review.visible.length} ticked`
            : `select all ${review.visible.length}`"
          @update:model-value="review.pickAll($event)"
        />
        <span class="spacer" />
        <UiButton v-if="confirmedCount" intent="secondary" size="small"
                  :label="`tick the ${confirmedCount} the engine calls correct`"
                  @click="review.pickConfirmed()" />
        <UiButton intent="primary" size="small" :disabled="!review.pickedRows.length"
                  :label="`Approve ${review.pickedRows.length || ''}`" @click="acceptPicked" />
      </div>

      <!-- The Accepted list (bucket 'accepted'): every recorded verdict, revisitable. -->
      <div v-if="review.bucket === 'accepted'" class="review-rows" style="overflow: auto">
        <div v-for="a in review.acceptedEntries" :key="a.key + a.code" class="acceptedrow">
          <div>
            <span class="k mono">{{ a.key }}</span>
            <UiTag intent="success" :value="a.code" />
            <span class="muted"> by {{ a.by }}</span>
          </div>
          <UiButton intent="ghost" size="small" label="Un-accept" @click="unacceptEntry(a)" />
        </div>
        <EmptyState v-if="!review.acceptedEntries.length" compact icon="CheckSquare"
                    message="Nothing accepted yet for this language." />
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
                {{ verdictOf(r) === "same" ? "correct?" : "skipped?" }}
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
          {{ review.activeRow.key.split('.').slice(0, -1).join(' › ') || 'root' }}
        </p>
        <!-- why is this flagged — the code, plus what the check looks for in plain English -->
        <div v-if="review.activeRow.flags.length" style="margin-bottom: 8px">
          <div v-for="(f, i) in hard" :key="`h${i}`" class="finding">
            <span class="code">{{ f.code }}</span>{{ WHY[f.code] ?? f.detail }}
          </div>
          <div v-for="(f, i) in soft" :key="`s${i}`" class="finding advisory">
            <span class="code">{{ f.code }}</span>{{ f.detail }}
            <template v-if="f.confirmed">
              <br /><span class="muted">engine says: {{ f.confirmed === 'same' ? 'correct as-is' : 'looks skipped' }}
              <template v-if="f.suggestion"> — suggests “{{ f.suggestion }}” (not applied)</template>
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
          <UiButton intent="primary" label="Save" @click="saveDraft" />
          <UiButton intent="secondary" label="Accept as correct" title="a" @click="acceptActive" />
          <UiButton intent="ghost" label="Unaccept" @click="unacceptActive" />
          <UiButton intent="ghost" label="Skip" title="j" @click="review.move(1)" />
        </div>
      </div>

      <!-- what a run proposed — never applied by anyone but you -->
      <div class="card" v-if="activeProposal">
        <h2>Proposed by {{ activeProposal.engine }}</h2>
        <div class="srcbox">{{ activeProposal.value }}</div>
        <div class="row" style="margin-top: 8px">
          <UiButton intent="secondary" size="small" label="Use this" @click="useProposal" />
          <UiButton intent="primary" size="small" label="Apply" @click="applyProposalActive" />
          <UiButton intent="ghost" size="small" label="Discard" @click="discardProposalActive" />
        </div>
      </div>

      <!-- the Google second opinion (g) — an iframe over the server's /v1/gt-frame crop -->
      <div class="card">
        <div class="row">
          <h2 style="margin: 0">Second opinion — Google Translate</h2>
          <span class="spacer" />
          <UiButton intent="ghost" size="small" :label="showGoogle ? 'Hide' : 'Show'" title="g"
                    @click="showGoogle = !showGoogle" />
        </div>
        <div v-if="showGoogle" class="gtclip">
          <iframe :src="gtSrc" title="Google Translate" />
        </div>
        <p v-else class="hint" style="margin: 6px 0 0">
          An independent reading. Neither source is reliably better — on one measured key the
          local model was right and Google wrong; on another, the reverse. Copy it across only
          if you agree.
        </p>
      </div>

      <!-- what it says in English (b) -->
      <div class="card">
        <div class="row">
          <h2 style="margin: 0">What it says in English</h2>
          <span class="spacer" />
          <UiButton intent="ghost" size="small" :label="review.detail?.english ? 'Again' : 'Read it back'"
                    title="b" :disabled="backBusy" @click="backtranslate" />
        </div>
        <p :class="review.detail?.english ? '' : 'hint'" style="margin: 6px 0 0">
          {{ review.detail?.english
            || 'Renders your translation back into English with the local model. Catches wrong words — not every defect, since an ambiguous source round-trips unchanged.' }}
        </p>
      </div>

      <div class="card" v-if="review.detail?.siblings?.length">
        <h2>Siblings</h2>
        <p class="hint">The same namespace — how the pattern is rendered next door.</p>
        <div v-for="s in review.detail.siblings" :key="s.key" class="sib">
          <span>{{ s.source }}</span><span>{{ s.target }}</span>
        </div>
      </div>

      <div class="card">
        <h2>Note for the next run</h2>
        <p class="hint">
          Sent WITH this key next time it translates — how "Why:" stops coming back as
          "¿Por qué?". Fix it once, it stays fixed.
        </p>
        <div class="row">
          <UiTextarea v-model="noteDraft" class="detail-text" style="min-height: 40px"
                      placeholder="e.g. a label above a reasoning block, not a question" />
        </div>
        <div class="row" style="margin-top: 8px">
          <UiButton intent="secondary" label="Save note" @click="saveNote" />
        </div>
      </div>
    </div>
    <div class="review-detail" v-else-if="review.bucket !== 'accepted'">
      <EmptyState icon="CheckSquare" title="Nothing selected"
                  :message="review.visible.length ? 'Pick a key, or press j to start.' : queueEmptyMessage" />
    </div>
    <div class="review-detail" v-else>
      <EmptyState icon="CheckSquare" title="Accepted verdicts"
                  message="Every entry names its check, pair of strings and reviewer. Un-accept puts a key back in the queue — a decision can always be revisited." />
    </div>
  </div>
</template>
