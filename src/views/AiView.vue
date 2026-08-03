<script setup>
// SPDX-License-Identifier: MIT
// The kit's whole AI area — providers (finally addable from the UI), model catalog
// with downloads + cancel, engine presets, the usage/token ledger. ONE component,
// the same surface JW and JV mount; this app adds no app-tab (its features build
// their own prompts — feature_prompts={} is deliberate, see server/app.py).
import { AiModelsArea } from "@delebash/llm-ui";
</script>

<template>
  <div class="ai-area">
    <AiModelsArea />
  </div>
</template>
