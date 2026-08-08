// SPDX-License-Identifier: MIT
// UI chrome state: appearance + the ui flags, server-backed via the family
// /v1/prefs door (target-tree P9 — left localStorage so they survive
// reinstall/machine moves and ride app.db's backup/restore/reset). readPref
// serves from the cache bootPrefs() filled — main.js awaits bootPrefs BEFORE
// this store first initializes, pre-mount. (The design-variant switch died
// 2026-08-03 when Design 1 was ruled.)
import { defineStore } from "pinia";
import { readPref, useModelApply, writePref } from "@delebash/llm-ui";
import { applyAppearance, migrateAppearance } from "../services/appearance.js";

export const useUiStore = defineStore("ui", {
  state: () => ({
    appearance: migrateAppearance(readPref("appearance", {})),
    aiOfferShown: readPref("aiOfferShown", false) === true, // the once-ever AI offer's flag (ruling R3)
    aiOfferOpen: false,
    keepServerRunning: readPref("keepServerRunning", false) === true, // the family headless ruling (2026-08-04)
  }),
  actions: {
    markAiOfferShown() {
      this.aiOfferShown = true;
      writePref("aiOfferShown", true);
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
      writePref("keepServerRunning", !!v);
    },
    boot() {
      applyAppearance(this.appearance);
    },
    setAppearance(patch) {
      this.appearance = { ...this.appearance, ...patch };
      // The WRAPPER doc {appearance: {...}} — the kit's migrateAppearance reads
      // `persisted.appearance`; the flat object silently lost mode/font/scale on
      // every restart (found by the 2026-08-05 audit, proven by execution).
      writePref("appearance", { appearance: this.appearance });
      applyAppearance(this.appearance);
    },
    cycleMode() {
      const order = ["system", "light", "dark"];
      const next = order[(order.indexOf(this.appearance.mode || "system") + 1) % order.length];
      this.setAppearance({ mode: next });
    },
  },
});
