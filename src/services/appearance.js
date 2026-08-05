// SPDX-License-Identifier: MIT
// Appearance — the JV pattern: the generic theme engine + catalogs are SHARED
// (kit @delebash/llm-ui appearance); this file only sets the app's brand
// defaults and re-exports the catalogs a Settings surface would render.
// Quiet-professional: Inter UI stack, indigo accent (hue 277 = #4f46e5's TRUE
// OKLCH hue, computed exactly 2026-08-05 — the old 243 claim was wrong).
import {
  applyAppearance as applyGeneric,
  migrateAppearance as migrateGeneric,
  DEFAULT_APPEARANCE as GENERIC_DEFAULT,
} from "@delebash/llm-ui";

export {
  UI_FONTS, UI_SCALES, INK_PALETTES, ACCENT_PRESETS, GOLD_PRESETS, FUNCTIONAL_PRESETS,
  BUTTON_RADIUS_OPTIONS, BUTTON_DENSITY_OPTIONS, BUTTON_LABEL_CASE_OPTIONS, currentMode,
} from "@delebash/llm-ui";

export const DEFAULT_APPEARANCE = {
  ...GENERIC_DEFAULT,
  uiFont: "Inter",
  accentHue: 277,
};

export function applyAppearance(appearance) {
  applyGeneric({ ...DEFAULT_APPEARANCE, ...(appearance || {}) });
}

export function migrateAppearance(persisted = {}) {
  return migrateGeneric(persisted, DEFAULT_APPEARANCE);
}
