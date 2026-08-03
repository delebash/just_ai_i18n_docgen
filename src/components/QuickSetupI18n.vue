<script setup>
// SPDX-License-Identifier: MIT
// This app's setup wizard — purpose-built for translation (the family rule: kit owns
// the machinery, each app owns its steps and words; JW's QuickSetup stays JW's).
// One job, narrated end to end: pick a TRANSLATION-MEASURED model (the app seeds only
// those — docs/models.md), then one click runs the same workflow every load button
// runs: engine check → install-if-missing → download → load — each phase visible on
// the shared DownloadBars — then the model becomes the local default, which the
// translate/confirm presets follow. No embedding step: this app has none.
//
// Contract with AiModelsArea's wizard seam: `inline` prop, expose openWizard(),
// emit `changed` + `closed`.
import { computed, ref, watch } from "vue";
import {
  AppModal, DownloadBar, UiButton, UiSelect, pushToast,
  useModelApply, useRunnerModels,
} from "@delebash/llm-ui";

defineProps({ inline: { type: Boolean, default: false } });
const emit = defineEmits(["changed", "closed"]);

const open = ref(false);
const busy = ref(false);
const done = ref(false);
const pick = ref("");

const rm = useRunnerModels();
const { setAsDefault, refreshApplied } = useModelApply();

// The catalog is translation-only for this app (server seeds it that way), ordered
// by the measured ranking. Options carry the size so the download is no surprise.
const options = computed(() =>
  (rm.models.value || [])
    .slice()
    .sort((a, b) => (a.qualityRank ?? 99) - (b.qualityRank ?? 99))
    .map((m) => ({
      label: `${m.name || m.id}${m.sizeLabel ? ` · ${m.sizeLabel}` : ""}`,
      value: m.id,
    })),
);
watch(options, (opts) => {
  if (!pick.value && opts.length) pick.value = opts[0].value; // measured rank 1
}, { immediate: true });

const pickedModel = computed(() => rm.models.value.find((m) => m.id === pick.value) || null);
const pickStatus = computed(() => pickedModel.value?.status || "");
const loadTask = computed(() => (pick.value ? rm.taskFor(pick.value) : null));
const engineTask = computed(() =>
  rm.engineGateTask?.value && rm.engineGateTask.value.state === "running" ? rm.engineGateTask.value : null);

// The narration — one line that always says what is happening right now.
const stage = computed(() => {
  if (done.value) return "Done — Translate and Confirm now run on this model.";
  if (!busy.value) return "";
  if (engineTask.value) return "Setting up the llama.cpp engine (one-time)…";
  if (loadTask.value) return "Downloading and loading the model — you can keep using the app…";
  if (pickStatus.value === "loaded" || pickStatus.value === "sleeping") return "Wiring it as the default…";
  return "Starting…";
});

async function openWizard() {
  open.value = true;
  done.value = false;
  try { await rm.refresh?.(); } catch { /* the catalog list below still shows state */ }
}
defineExpose({ openWizard });

async function run() {
  if (!pick.value || busy.value) return;
  busy.value = true;
  try {
    // The ONE workflow every load button runs (JW's warm-boot rule: no bespoke
    // paths): retryLoad = engine check → install-if-missing → download → load.
    await rm.retryLoad(pick.value);
  } catch (e) {
    pushToast({ kind: "error", title: "Setup failed", description: String(e?.message || e) });
    busy.value = false;
  }
}

// The load settles when the model goes resident — then the default follows the pick
// and the presets (provider local-llamacpp, model = provider default) follow that.
watch(pickStatus, async (s) => {
  if (!busy.value || !pick.value) return;
  if (s === "loaded" || s === "sleeping") {
    try {
      await setAsDefault(pick.value);
      await refreshApplied();
      done.value = true;
      emit("changed");
      pushToast({ kind: "success", title: "Local translation AI ready",
                  description: "Translate and Confirm run on this model — change it any time under Routing by feature." });
    } catch (e) {
      pushToast({ kind: "error", title: "Could not set the default", description: String(e?.message || e) });
    } finally {
      busy.value = false;
    }
  } else if (s === "error") {
    busy.value = false; // the bar shows the error + Retry; the status line stops lying
  }
});

function close() {
  open.value = false;
  emit("closed");
}
</script>

<template>
  <div class="qs18">
    <div class="row">
      <UiButton intent="primary" label="Run Quick Setup" @click="openWizard" />
      <span class="hint" style="margin: 0">
        A free local translation engine in one click — the models offered here are the
        ones MEASURED on real localisation runs, sized to this PC.
      </span>
    </div>

    <!-- A REAL wizard (modal), not an inline morph — 'Run Quick Setup does nothing'
         was the inline swap reading as broken (user, 3rd report, 2026-08-03). -->
    <AppModal v-if="open" eyebrow="Quick Setup" title="Local translation AI" @close="close">
      <div class="qs18__panel">
      <p class="hint">
        Pick a model — the list is translation-measured only, best first
        (docs/models.md; measured, not assumed). One click installs the llama.cpp
        engine if needed, downloads the model, loads it, and wires it as the default
        the Translate &amp; Confirm presets follow.
      </p>
      <div class="row">
        <UiSelect v-model="pick" :options="options" width="prose" placeholder="pick a model…" :disabled="busy" />
        <UiButton
          intent="primary"
          :label="busy ? 'Working…' : done ? 'Done ✓' : 'Set it up'"
          :disabled="busy || !pick || done" @click="run"
        />
        <UiButton intent="ghost" :label="done ? 'Close' : 'Cancel'" @click="close" />
      </div>
      <p v-if="stage" class="hint qs18__stage" style="margin: 0">{{ stage }}</p>
      <DownloadBar v-if="engineTask" :task="engineTask" title="llama.cpp engine" />
      <DownloadBar v-else-if="busy && loadTask" :task="loadTask" :title="pickedModel?.name || pick" />
      <p v-if="!options.length" class="hint" style="margin: 0">
        No models in the catalog yet — add any HF GGUF from the catalog below, or check
        that the server is reachable.
      </p>
      </div>
    </AppModal>
  </div>
</template>
