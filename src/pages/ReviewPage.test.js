// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// Review's detail pane says what the confirmation pass thought, under the finding it annotates. The pass annotates
// only `untranslated` — a hard finding — and the pane printed the verdict only under advisory ones, so it never
// showed (the docs pass, 2026-11-07: "docgen's Review verdict line never shows"). Mounted as the app runs it: Quasar
// installed, the app's real vue-i18n and stores; only the server calls are stubbed.
import { QUASAR_TEST_OPTIONS } from "@delebash/ui/quasar/install.js";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import * as quasar from "quasar";
import { afterEach, expect, test } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

const { i18n } = await import("../i18n/index.js");
const { useProjectStore } = await import("../stores/project.js");
const { useReviewStore } = await import("../stores/review.js");
const { default: ReviewPage } = await import("./ReviewPage.vue");

const QUASAR_COMPONENTS = Object.fromEntries(Object.entries(quasar).filter(([k, v]) => /^Q[A-Z]/.test(k) && v?.name));

/** A row as the server's buildRows sends it (workspace.js). */
const row = (key, flags) => ({
  lang: "es", key, source: "OK", target: "OK", flags, status: null, note: null, hasProposal: false,
});

let wrapper;
afterEach(() => wrapper?.unmount());

async function mountWith(rows) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/review", component: ReviewPage }] });
  router.push("/review");
  await router.isReady();
  const pinia = createPinia();
  const project = useProjectStore(pinia);
  project.refresh = async () => {};
  project.fetchSummary = async () => null;
  project.langs = ["es"];
  const review = useReviewStore(pinia);
  // the server's answer, without the server: the rows as loaded, the first one open
  review.refresh = async () => {};
  review.open = async (key) => {
    review.activeKey = key;
  };
  Object.assign(review, { rows, lang: "es", loaded: true, bucket: "all", activeKey: rows[0].key });
  wrapper = mount(ReviewPage, {
    attachTo: document.body,
    global: { plugins: [[quasar.Quasar, { ...QUASAR_TEST_OPTIONS, components: QUASAR_COMPONENTS }], i18n, pinia, router] },
  });
  await flushPromises();
  return wrapper.find(".review-detail");
}

test("the engine's verdict shows under the untranslated finding it annotates", async () => {
  const detail = await mountWith([
    row("common.ok", [
      { code: "untranslated", detail: "identical to the source string", advisory: false, suggestion: null, confirmed: "same", confirmedBy: "Gemma 4 26B" },
    ]),
  ]);
  expect(detail.exists()).toBe(true);
  const text = detail.text();
  expect(text).toContain("untranslated");
  expect(text).toContain("engine says: correct as-is");
  expect(text).toContain("(Gemma 4 26B)");
});

test("a skipped verdict with a suggestion says both, and a finding without one says neither", async () => {
  const detail = await mountWith([
    row("common.ok", [
      { code: "untranslated", detail: "identical to the source string", advisory: false, suggestion: "Vale", confirmed: "skipped", confirmedBy: "Gemma 4 26B" },
      { code: "disagreement", detail: "the second pass differs", advisory: true, suggestion: null, confirmed: null, confirmedBy: null },
    ]),
  ]);
  const findings = detail.findAll(".finding");
  expect(findings).toHaveLength(2);
  // hard first, then advisory
  expect(findings[0].text()).toContain("untranslated");
  expect(findings[0].text()).toContain("engine says: looks skipped");
  expect(findings[0].text()).toContain("“Vale”");
  expect(findings[1].classes()).toContain("advisory");
  expect(findings[1].text()).not.toContain("engine says");
});
