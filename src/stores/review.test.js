// SPDX-License-Identifier: MIT
// The review store over a mocked kit transport: Undo is the shown language's (2026-10-29 — it posted
// no language, and the server undid the last action in any language).
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";

const calls = [];
vi.mock("@delebash/ui", () => ({
  post: async (p, b) => {
    calls.push(["POST", p, b]);
    return {};
  },
  get: async (p) => {
    calls.push(["GET", p]);
    return { rows: [], counts: {}, accepted: 0, total: 0 };
  },
  put: async () => ({}),
  del: async () => ({}),
  safeRequest: async () => null,
}));

const { useReviewStore } = await import("./review.js");

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
});

test("Undo undoes the shown language's last action", async () => {
  const review = useReviewStore();
  review.lang = "fr";
  review.refresh = async () => {};
  await review.undo();
  expect(calls[0]).toEqual(["POST", "/v1/undo", { lang: "fr" }]);
});
