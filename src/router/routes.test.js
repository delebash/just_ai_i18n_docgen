// SPDX-License-Identifier: MIT
// The routes (router/routes.js): an address the app has no page for lands on the not-found page inside the
// chrome (the template's), never a blank window; the app's pages and /offline still resolve to themselves.
import { createMemoryHistory, createRouter } from "vue-router";
import { expect, test } from "vitest";
import routes from "./routes.js";

const router = createRouter({ history: createMemoryHistory(), routes });
const last = (path) => router.resolve(path).matched.at(-1)?.path;

test("an unknown address is the not-found page, inside the layout", () => {
  const r = router.resolve("/no/such/page");
  expect(r.matched[0].path).toBe("/");
  expect(last("/no/such/page")).toBe("/:catchAll(.*)*");
});

test("the pages and the connection-error route resolve as before", () => {
  expect(last("/review")).toBe("/review");
  expect(last("/settings/storage")).toBe("/settings/:section?");
  expect(last("/offline")).toBe("/offline");
});
