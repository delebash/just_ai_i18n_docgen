// SPDX-License-Identifier: MIT
// UI chrome state: appearance, persisted locally and applied through the kit
// engine. (The design-variant switch died 2026-08-03 when Design 1 was ruled.)
import { defineStore } from "pinia";
import { applyAppearance, migrateAppearance } from "../services/appearance.js";

const K_APPEARANCE = "jaid.appearance";

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

export const useUiStore = defineStore("ui", {
  state: () => ({
    appearance: migrateAppearance(readJson(K_APPEARANCE)),
  }),
  actions: {
    boot() {
      applyAppearance(this.appearance);
    },
    setAppearance(patch) {
      this.appearance = { ...this.appearance, ...patch };
      localStorage.setItem(K_APPEARANCE, JSON.stringify(this.appearance));
      applyAppearance(this.appearance);
    },
    cycleMode() {
      const order = ["system", "light", "dark"];
      const next = order[(order.indexOf(this.appearance.mode || "system") + 1) % order.length];
      this.setAppearance({ mode: next });
    },
  },
});
