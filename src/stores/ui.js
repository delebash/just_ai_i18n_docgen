// SPDX-License-Identifier: MIT
// UI chrome state: appearance (persisted, applied through the kit engine) and the
// TEMPORARY design-variant switch for the live design iteration — three shells in
// App.vue, one number here. Remove `design` (and the switcher) once one is ruled.
import { defineStore } from "pinia";
import { applyAppearance, migrateAppearance } from "../services/appearance.js";

const K_APPEARANCE = "jaid.appearance";
const K_DESIGN = "jaid.design";

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
    design: Number(localStorage.getItem(K_DESIGN)) || 1,
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
    setDesign(n) {
      this.design = n;
      localStorage.setItem(K_DESIGN, String(n));
    },
  },
});
