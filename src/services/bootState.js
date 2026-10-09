// SPDX-License-Identifier: MIT
// What the start-up decided, for the root component (App.vue): "app" — the shell; "server-down" —
// the kit's connection-error screen (all data lives in the server, so nothing loads without it).
// The boot file (boot/docgen.js) sets it.
import { ref } from "vue";

export const bootView = ref("app");
