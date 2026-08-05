// SPDX-License-Identifier: MIT
// UI chrome state: appearance, persisted locally and applied through the kit
// engine. (The design-variant switch died 2026-08-03 when Design 1 was ruled.)
import { defineStore } from "pinia";
import { useModelApply } from "@delebash/llm-ui";
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
    aiOfferOpen: false,
    keepServerRunning: localStorage.getItem(K_KEEP_RUNNING) === "1",
  }),
  actions: {
    markAiOfferShown() {
      this.aiOfferShown = true;
      localStorage.setItem(K_AI_OFFER, "1");
    },
    // The once-ever AI offer, fired at Setup-save (the user's ruling 2026-08-04:
    // JW's donor fires right after the FIRST project is created/opened — this
    // app's equivalent moment is Setup's first successful save; the boot-time
    // approximation died 2026-08-05, having popped mid-suite over real dialogs).
    async maybeOfferAiSetup() {
      if (this.aiOfferShown) return;
      try {
        const { refreshApplied, currentDefaultProviderId } = useModelApply();
        await refreshApplied();
        if (!currentDefaultProviderId.value) this.aiOfferOpen = true;
      } catch { /* unknown state → no offer; the AI page's band still serves */ }
    },
    closeAiOffer() {
      this.aiOfferOpen = false;
      this.markAiOfferShown();
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
      // The WRAPPER doc {appearance: {...}} — the kit's migrateAppearance reads
      // `persisted.appearance`; the flat object silently lost mode/font/scale on
      // every restart (found by the 2026-08-05 audit, proven by execution).
      localStorage.setItem(K_APPEARANCE, JSON.stringify({ appearance: this.appearance }));
      applyAppearance(this.appearance);
    },
    cycleMode() {
      const order = ["system", "light", "dark"];
      const next = order[(order.indexOf(this.appearance.mode || "system") + 1) % order.length];
      this.setAppearance({ mode: next });
    },
  },
});
