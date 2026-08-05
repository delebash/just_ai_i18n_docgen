// SPDX-License-Identifier: MIT
// UI chrome state: appearance, persisted locally and applied through the kit
// engine. (The design-variant switch died 2026-08-03 when Design 1 was ruled.)
import { defineStore } from "pinia";
import { applyAppearance, migrateAppearance } from "../services/appearance.js";

const K_APPEARANCE = "jaid.appearance";
const K_AI_OFFER = "jaid.aiOfferShown"; // the once-ever AI offer's flag (ruling R3)
const K_KEEP_RUNNING = "jaid.keepServerRunning"; // the family headless ruling (2026-08-04)

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
    aiOfferShown: localStorage.getItem(K_AI_OFFER) === "1",
    keepServerRunning: localStorage.getItem(K_KEEP_RUNNING) === "1",
  }),
  actions: {
    markAiOfferShown() {
      this.aiOfferShown = true;
      localStorage.setItem(K_AI_OFFER, "1");
    },
    setKeepServerRunning(v) {
      this.keepServerRunning = !!v;
      localStorage.setItem(K_KEEP_RUNNING, v ? "1" : "0");
    },
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
