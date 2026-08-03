<script setup>
// SPDX-License-Identifier: MIT
// This app's THIN setup wizard — the family wizard rule (2026-08-03): the kit owns
// the machinery (catalog meta + quality order, engine install, download/load, the
// DownloadBar), each app owns its steps and words. This one has i18n's words and
// exactly i18n's needs: ONE good local model for translation, wired as the default
// the translate/confirm presets follow. NO embedding step — this app has no
// embedding features, and JW's QuickSetup carries embedding through its core,
// which is why it isn't mounted here (its copy is also written for writing).
//
// Contract with AiModelsArea's wizard seam: `inline` prop, expose openWizard(),
// emit `changed` (providers/defaults moved) + `closed`.
import { computed, ref, watch } from "vue";
import {
  DownloadBar, UiButton, UiSelect, pushToast,
  useCatalogMeta, useModelApply, useRunnerModels,
} from "@delebash/llm-ui";

defineProps({ inline: { type: Boolean, default: false } });
const emit = defineEmits(["changed", "closed"]);

const open = ref(false);
const busy = ref(false);
const done = ref(false);
const pick = ref("");

const rm = useRunnerModels();
const { qualityById, embeddingById, refresh: refreshMeta } = useCatalogMeta();
const { setAsDefault, refreshApplied } = useModelApply();

// LLMs only (no embedding — see header), best quality first. The measured
// translation flagship (docs/models.md: the gemma-4 QAT run on the real
// 1,965-key catalogue) leads when the catalog carries it.
const options = computed(() => {
  const rows = (rm.models.value || []).filter((m) => embeddingById.value[m.id] !== true);
  rows.sort((a, b) => (qualityById.value[b.id] ?? 0) - (qualityById.value[a.id] ?? 0));
  return rows.map((m) => ({ label: m.name || m.id, value: m.id }));
});
watch(options, (opts) => {
  if (pick.value || !opts.length) return;
  const flagship = opts.find((o) => /gemma-4/i.test(o.value));
  pick.value = (flagship || opts[0]).value;
}, { immediate: true });

const loadTask = computed(() => (pick.value ? rm.taskFor(pick.value) : null));
const engineTask = computed(() =>
  rm.engineGateTask?.value && rm.engineGateTask.value.state === "running" ? rm.engineGateTask.value : null);
const pickStatus = computed(() =>
  pick.value ? (rm.models.value.find((m) => m.id === pick.value)?.status || "") : "");

async function openWizard() {
  open.value = true;
  done.value = false;
  await Promise.all([rm.refresh?.() ?? Promise.resolve(), refreshMeta?.() ?? Promise.resolve()]);
}
defineExpose({ openWizard });

async function run() {
  if (!pick.value || busy.value) return;
  busy.value = true;
  try {
    // The ONE workflow every load button runs: engine check → install-if-missing
    // → download → load. Then the default follows the pick — the translate and
    // confirm presets point at the local provider and ride its default model.
    await rm.retryLoad(pick.value);
  } catch (e) {
    pushToast({ kind: "error", title: "Setup failed", description: String(e?.message || e) });
    busy.value = false;
  }
}

// The load settles when the model goes resident — then wire the default.
watch(pickStatus, async (s) => {
  if (!busy.value || !pick.value) return;
  if (s === "loaded" || s === "sleeping") {
    try {
      await setAsDefault(pick.value);
      await refreshApplied();
      done.value = true;
      emit("changed");
      pushToast({ kind: "success", title: "Local AI ready",
                  description: "Translate and Confirm now run on this model." });
    } finally {
      busy.value = false;
    }
  }
});

function close() {
  open.value = false;
  emit("closed");
}
</script>

<template>
  <div class="qs18">
    <div v-if="!open" class="row">
      <UiButton intent="primary" label="Run Quick Setup" @click="openWizard" />
      <span class="hint" style="margin: 0">
        Sets up a free local translation engine — pick the model measured best for
        translation that fits this PC; one click installs llama.cpp, downloads it,
        and Translate &amp; Confirm run on it.
      </span>
    </div>

    <div v-else class="qs18__panel">
      <h3>Local translation AI</h3>
      <p class="hint">
        The default pick is the best-measured translation model for this catalogue
        (see docs/models.md — measured, not assumed). Everything runs on this PC, free.
      </p>
      <div class="row">
        <UiSelect v-model="pick" :options="options" width="prose" placeholder="pick a model…" />
        <UiButton
          intent="primary" :label="busy ? 'Setting up…' : done ? 'Done ✓' : 'Set up'"
          :disabled="busy || !pick || done" @click="run"
        />
        <UiButton intent="ghost" :label="done ? 'Close' : 'Cancel'" @click="close" />
      </div>
      <DownloadBar v-if="engineTask" :task="engineTask" title="Setting up the engine" />
      <DownloadBar v-else-if="busy && loadTask" :task="loadTask" />
      <p v-if="done" class="hint" style="margin: 8px 0 0">
        Routing → the Translate and Confirm presets follow the local default. Change
        either any time under <b>Routing by feature</b>.
      </p>
    </div>
  </div>
</template>
