// SPDX-License-Identifier: MIT
// On startup, run the SAME workflow every load button runs — nothing bespoke.
// JW's warmStartup.js, verbatim shape (its 2026-07-21 ruling: "run existing
// function 1 2 3, no new fancy warm boot function"):
//   1. read the warmDefaultOnStartup toggle (the AI page's built-in provider row),
//   2. resolve the default LOCAL chat model (empty ⇒ cloud default ⇒ no-op),
//   3. useRunnerModels().retryLoad — engine check → install-if-missing → load.
// `warmModelId` is exported so App.vue renders the SHARED engine + load
// DownloadBars on the boot splash while it runs (reuse only — no new bar).

import { ref } from "vue";
import { get, useModelApply, useRunnerModels } from "@delebash/llm-ui";

// The model being warmed ("" = none). App.vue renders the boot bars for it.
export const warmModelId = ref("");

export async function startWarmOnBoot() {
  try {
    const cfg = await get("/v1/ai/engine-config");
    if (!cfg?.warmDefaultOnStartup) return; // toggle off → nothing to do

    const { refreshApplied, currentDefaultId } = useModelApply();
    await refreshApplied();
    const modelId = currentDefaultId.value;
    if (!modelId) return; // default isn't the local runner → no-op

    warmModelId.value = modelId;
    useRunnerModels().retryLoad(modelId);
  } catch {
    // best-effort — the on-demand load on first use still covers a miss
    warmModelId.value = "";
  }
}
