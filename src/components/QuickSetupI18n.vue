<script setup>
// SPDX-License-Identifier: MIT
// This app's setup wizard — purpose-built for translation (the family rule: kit owns
// the machinery, each app owns its steps and words; JW's QuickSetup stays JW's).
//
// DONOR: kit `views/QuickSetup.vue` — its apply() (:441), its two task watchers
// (:404-419) and its footer/closable rules (:640-859). Read those before changing
// anything here; the first version of this file copied the SHAPE and invented its own
// completion logic, which is the whole reason for the rewrite below (2026-08-03).
//
// THE MODEL: a step machine — confirm → apply → done — that advances on TERMINAL TASK
// STATES, never on a watched model status. Each phase is a real `createDownloadTask`
// over its server channel (the same machine the catalog and JW's wizard use), so every
// outcome lands somewhere visible: done advances, error and cancelled stop with the
// bar's own Retry. The status-watching version hung on three real paths — a model that
// was ALREADY resident (its row never changes, so the watcher never fires), a failed or
// cancelled engine install (`retryLoad` swallows its own errors and never throws), and
// a download the user cancelled (the row leaves `loading` for a state the watcher has no
// branch for). All three left "Working…" on screen forever.
//
// Contract with AiModelsArea's wizard seam: `inline` prop, expose openWizard(),
// emit `changed` + `closed`.
import { computed, ref, watch } from "vue";
import {
  AppModal, DownloadBar, UiButton, UiSelect, createDownloadTask, engineInstallChannel,
  get, modelLoadChannel, pushToast, useCatalogMeta, useModelApply, useRunnerModels,
} from "@delebash/llm-ui";

defineProps({ inline: { type: Boolean, default: false } });
const emit = defineEmits(["changed", "closed"]);

const open = ref(false);
// detect = priming (the donor's own first step, QuickSetup.vue:278/648): the catalog
// and the engine status are fetched BEFORE anything is offered, so nobody sees an empty
// picker over a dead "Set it up". Found by the behavior test — it clicked the moment the
// dialog existed, which is exactly what a fast user does.
const step = ref("detect"); // detect | confirm | apply | done
const error = ref("");
const pick = ref("");
const engineNeeded = ref(false);

const rm = useRunnerModels();
const { setAsDefault, refreshApplied, LOCAL_RUNNER_ID } = useModelApply();
// The measured ranking, the size and the blurb live on the CATALOG rows
// (/v1/ai/model-catalog), NOT on the fit-shaped /v1/llm-runner/models view — the kit
// says so in useCatalogMeta.js:24 and exports this composable so an app wizard can rank
// without forking QuickSetup. An earlier version read `qualityRank` and `sizeLabel`
// straight off the model row: both are absent there, so the sort silently fell back to
// insertion order and the size never rendered. Guessed fields fail silently; that is
// what makes them worth checking.
const {
  qualityById, descriptionById, sizeBytesById, refresh: refreshCatalogMeta,
} = useCatalogMeta();

// The two bars, donor-shaped: the engine install (only when it isn't installed) and the
// model load. The load channel takes a THUNK so a re-run reads the live pick.
const engineTask = createDownloadTask(engineInstallChannel());
const loadTask = createDownloadTask(modelLoadChannel(() => pick.value));
// While either runs there is exactly ONE way out — the bar's own Cancel. The modal has
// no X and the footer has no buttons (donor QuickSetup.vue:644 + :843): two controls
// both labelled Cancel, meaning different things, is the bug the user caught.
const running = computed(() => engineTask.state === "running" || loadTask.state === "running");

// The catalog is translation-only for this app (the server seeds it that way), best
// first by the MEASURED rank (donor's qualityOf, QuickSetup.vue:82). The label carries
// the download size, because that is what the choice costs.
const qualityOf = (m) => qualityById.value[m.id] ?? 100;
const options = computed(() =>
  (rm.models.value || [])
    .slice()
    .sort((a, b) => qualityOf(a) - qualityOf(b))
    .map((m) => {
      const bytes = sizeBytesById.value[m.id] || 0;
      return {
        label: `${m.name || m.id}${bytes ? ` · ${rm.fmtBytes(bytes)}` : ""}`,
        value: m.id,
      };
    }),
);
// (No watcher preselects here. `rm.models` can populate BEFORE the catalog meta the
// ranking comes from — the runner singleton fetches at app boot — so a watch would
// pick the first row of an UNRANKED list and then never revise it. openWizard resolves
// both sources and then chooses, which is also the donor's shape: it clears its pick on
// open and re-derives the recommendation, QuickSetup.vue:279.)

const pickedModel = computed(() => rm.models.value.find((m) => m.id === pick.value) || null);
// What this pick means for THIS PC: the kit's own fit vocabulary (FIT_LABEL — one
// wording on every surface) and whether the click is instant or a real download.
const pickNote = computed(() => {
  const m = pickedModel.value;
  if (!m) return "";
  return [rm.FIT_LABEL?.[m.fit] || "", m.downloaded ? "already on disk" : "downloads now"]
    .filter(Boolean).join(" · ");
});
// "About this model" — the donor's own line (QuickSetup.vue:672), same source.
const pickDescription = computed(() => descriptionById.value[pick.value] || "");

async function openWizard() {
  open.value = true;
  step.value = "detect";
  error.value = "";
  pick.value = "";
  engineTask.reset();
  loadTask.reset();
  // EVERYTHING the confirm step needs, primed together (the donor's detect step,
  // QuickSetup.vue:224): the fit-shaped model list, the catalog meta that carries the
  // rank/size/blurb, and whether this run includes an engine install. All three must
  // land BEFORE anything is offered — a step flip after only some of them is the same
  // race in a smaller window. An unreachable engine status counts as "installed": the
  // load then fails honestly on its own bar rather than opening an install nobody asked
  // for.
  try {
    const [, , st] = await Promise.all([
      rm.refresh?.(),
      refreshCatalogMeta(),
      get("/v1/llm-runner/engine/status").catch(() => null),
    ]);
    engineNeeded.value = st ? !st.installed : false;
  } catch {
    engineNeeded.value = false; // the list below still renders its last state
  }
  pick.value = options.value[0]?.value || ""; // the measured best, ranked by now
  step.value = "confirm"; // …only now is there something to choose
}
defineExpose({ openWizard });

// Routing is written when the run STARTS, not when it finishes — the donor's order
// (QuickSetup.vue:466, inside apply()). It matters on the path this wizard exists for:
// a first-run user who cancels a 6 GB download still ends up with a configured default,
// and the shared load workflow fetches the weights on the first translate run.
async function run() {
  if (!pick.value || running.value) return;
  error.value = "";
  try {
    await setAsDefault(LOCAL_RUNNER_ID, pick.value);
    await refreshApplied();
    emit("changed");
  } catch (e) {
    error.value = `Couldn't set the default: ${e?.message || e}`;
    return; // stay on confirm — nothing was started, so nothing needs stopping
  }
  step.value = "apply";
  engineTask.reset();
  loadTask.reset();
  if (engineNeeded.value) {
    loadTask.waiting("Waiting for the engine…"); // held bar, no server call (donor)
    engineTask.start();
  } else {
    loadTask.start();
  }
}

// The load is gated on the engine: fire it when the install finishes; when the install
// is cancelled or fails, say so ON the load bar rather than leaving it spinning. A
// successful engine Retry re-fires the load automatically (the watch runs again).
watch(() => engineTask.state, (s) => {
  if (step.value !== "apply") return;
  if (s === "done" && loadTask.state !== "done") loadTask.start();
  else if (s === "cancelled") loadTask.fail("The engine install was cancelled — install it above, then this continues.");
  else if (s === "error") loadTask.fail("The engine didn't install — retry it above, then this continues.");
});

// The wizard advances only when the model is genuinely live. `readLoadStatus` reports
// terminal `done` the moment /status says the router is running — which is why an
// ALREADY-RESIDENT model finishes on the first poll here instead of hanging.
watch(() => loadTask.state, (s) => {
  if (s === "done" && step.value === "apply") finish();
});

function finish() {
  if (step.value === "done") return; // a double-finish (retry after done) is a no-op
  step.value = "done";
  pushToast({
    kind: "success",
    title: "Local translation AI ready",
    description: "Translate and Confirm run on this model — change it any time under Routing by feature.",
  });
}

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

    <!-- A REAL wizard (modal), not an inline morph — "Run Quick Setup does nothing"
         was the inline swap reading as broken (user, 2026-08-03). -->
    <AppModal
      v-if="open" eyebrow="Quick Setup"
      :title="step === 'apply' ? 'Setting it up…' : step === 'done' ? 'Ready to translate' : 'Local translation AI'"
      :closable="!running" max-width="620px" @close="close"
    >
      <div class="qs18__panel">
        <p v-if="error" class="qs18__err">{{ error }}</p>

        <!-- Priming: the catalog + engine status, before anything is offered. -->
        <p v-if="step === 'detect'" class="hint" style="margin: 0">
          Reading your model catalog and checking the engine…
        </p>

        <template v-else-if="step === 'confirm'">
          <p class="hint" style="margin: 0">
            Pick a model — best first, and every one here was measured on real
            localisation runs rather than guessed at. One click installs the llama.cpp
            engine if it's missing, downloads the model, loads it, and makes it the
            model the Translate &amp; Confirm presets run on.
          </p>
          <UiSelect v-model="pick" :options="options" width="prose" placeholder="pick a model…" />
          <p v-if="pickNote" class="hint" style="margin: 0">{{ pickNote }}</p>
          <p v-if="pickDescription" class="qs18__about">
            <b>About this model:</b> {{ pickDescription }}
          </p>
          <p v-if="!options.length" class="hint" style="margin: 0">
            No models in the catalog yet — add any HF GGUF from the catalog below, or
            check that the server is reachable.
          </p>
        </template>

        <template v-else-if="step === 'apply'">
          <p class="hint" style="margin: 0">
            {{ engineTask.state
              ? "Installing the llama.cpp engine first, then your model."
              : "Downloading and loading your model." }}
          </p>
          <!-- Each bar carries its OWN Cancel and Retry — the only cancel on screen. -->
          <DownloadBar
            v-if="engineTask.state" title="llama.cpp engine"
            role="the program that runs models" :task="engineTask"
          />
          <DownloadBar
            v-if="loadTask.state" :title="pickedModel?.name || pick"
            role="translates your strings and checks its own work" :task="loadTask"
          />
          <p class="hint" style="margin: 0">
            A model is several gigabytes, so the first run takes a few minutes — it only
            downloads once. Cancel stops it; Retry starts it again. Your pick is already
            saved as the default either way.
          </p>
        </template>

        <template v-else>
          <p style="margin: 0"><b>{{ pickedModel?.name || pick }}</b> is loaded and ready.</p>
          <p class="hint" style="margin: 0">
            Translate and Confirm run on it — change that any time under Routing by feature.
          </p>
        </template>
      </div>

      <!-- Footer per step, donor rule: during a run there are NO footer buttons, so the
           bar's Cancel is unambiguous. -->
      <template #footer>
        <template v-if="step === 'confirm'">
          <UiButton intent="ghost" label="Cancel" @click="close" />
          <span class="spacer" />
          <UiButton intent="primary" label="Set it up" :disabled="!pick" @click="run" />
        </template>
        <template v-else-if="step === 'done'">
          <span class="spacer" />
          <UiButton intent="primary" label="Close" @click="close" />
        </template>
      </template>
    </AppModal>
  </div>
</template>
