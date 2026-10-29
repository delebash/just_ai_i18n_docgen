// SPDX-License-Identifier: MIT
// The review store over a mocked kit transport: Undo is the shown language's (2026-10-29 — it posted
// no language, and the server undid the last action in any language).
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";

const calls = [];
let rowsFail = null; // an error the next GET /v1/rows throws
vi.mock("@delebash/ui", () => ({
  post: async (p, b) => {
    calls.push(["POST", p, b]);
    return {};
  },
  get: async (p) => {
    calls.push(["GET", p]);
    if (rowsFail && p.startsWith("/v1/rows")) throw rowsFail;
    return { rows: [], counts: {}, accepted: 0, total: 0, langs: ["es"] };
  },
  put: async () => ({}),
  del: async () => ({}),
  safeRequest: async () => null,
}));

const { useReviewStore } = await import("./review.js");

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  rowsFail = null;
});

test("Undo undoes the shown language's last action", async () => {
  const review = useReviewStore();
  review.lang = "fr";
  review.refresh = async () => {};
  await review.undo();
  expect(calls[0]).toEqual(["POST", "/v1/undo", { lang: "fr" }]);
});

test("a queue that fails to load says so and is never shown as empty; Retry clears it (app-structure §17)", async () => {
  const review = useReviewStore();
  expect([review.loaded, review.loadFailed]).toEqual([false, null]);
  rowsFail = Object.assign(new TypeError("Failed to fetch"));
  await review.refresh("es");
  expect(review.loadFailed?.message).toBe("Failed to fetch");
  expect([review.loaded, review.loading]).toEqual([false, false]);
  rowsFail = null;
  await review.refresh("es");
  expect([review.loaded, review.loadFailed]).toEqual([true, null]);
});
