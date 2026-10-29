// SPDX-License-Identifier: MIT
// The project store over a mocked kit transport: Home's three honest states read the server's problem+json
// (app-structure §15, 2026-10-29) — only the needs-setup 409 is "no project"; anything else is the server down —
// and a path the server can't use reaches the page as the error itself, for the form to show under its field.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";

let answer;
vi.mock("@delebash/ui", () => ({
  get: async () => answer(),
  post: async () => answer(),
  put: async () => ({}),
  safeRequest: async () => null,
}));

const { useProjectStore } = await import("./project.js");

/** An error as the kit's transport throws it (apiError.js): the status and the problem on it. */
const httpError = (status, problem) => Object.assign(new Error(problem.detail), { status, problem, errors: problem.errors ?? [] });

beforeEach(() => setActivePinia(createPinia()));

test("the needs-setup 409 is no project; a 409 without it, or no answer at all, is the server down", async () => {
  const project = useProjectStore();
  answer = () => {
    throw httpError(409, { type: "x/needs-setup", title: "No project loaded", status: 409, detail: "no project loaded yet", needsSetup: true });
  };
  await project.fetchSummary();
  expect([project.noProject, project.serverDown]).toEqual([true, false]);

  answer = () => {
    throw httpError(409, { type: "x/conflict", title: "Conflict", status: 409, detail: "a job is already running" });
  };
  await project.fetchSummary();
  expect([project.noProject, project.serverDown]).toEqual([false, true]);

  answer = () => {
    throw new TypeError("Failed to fetch");
  };
  await project.fetchSummary();
  expect([project.noProject, project.serverDown]).toEqual([false, true]);

  answer = () => ({ langs: [] });
  await project.fetchSummary();
  expect([project.noProject, project.serverDown]).toEqual([false, false]);
});

test("a path the server can't use is thrown to the page, and the last inspection is cleared", async () => {
  const project = useProjectStore();
  answer = () => ({ keyCount: 3 });
  await project.inspectPath("C:/app/en.json");
  expect(project.inspect.keyCount).toBe(3);

  const refused = httpError(422, { status: 422, detail: "Request body failed validation.", errors: [{ type: "value_error", loc: ["body", "path"], msg: "no such file" }] });
  answer = () => {
    throw refused;
  };
  await expect(project.inspectPath("C:/nowhere/en.json")).rejects.toBe(refused);
  expect(project.inspect).toBeNull();
});
