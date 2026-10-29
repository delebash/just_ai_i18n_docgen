// SPDX-License-Identifier: MIT
// The runs store over a mocked kit — what it asks the server, which run it follows, when the next
// language in the queue starts, and what the Runs page's card reads. The follow itself is the
// kit's runServerJob (round D2; tested in the kit): here each follow is a deferred the test ends.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";

const calls = [];
const answers = new Map();
const follows = []; // one per runServerJob call: { opts, resolve, reject }
const reply = (method, path, body) => {
  calls.push([method, path, body]);
  for (const [k, v] of answers) if (`${method} ${path}`.startsWith(k)) return typeof v === "function" ? v(body) : structuredClone(v);
  throw new Error(`no answer for ${method} ${path}`);
};
vi.mock("@delebash/ui", () => ({
  post: async (p, b) => reply("POST", p, b),
  del: async (p) => reply("DELETE", p),
  safeRequest: async (p, fallback = null) => {
    try {
      return reply("GET", p);
    } catch {
      return fallback;
    }
  },
  pushToast: (t) => calls.push(["TOAST", t]),
  runServerJob: (opts) =>
    new Promise((resolve, reject) => {
      follows.push({ opts, resolve, reject });
    }),
}));

const { useJobsStore } = await import("./jobs.js");

const snapshot = (id, lang, state = "running", data = {}) => ({ id, kind: "translate", key: lang, state, progress: 0, error: null, data: { lang, ...data } });
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  answers.clear();
  follows.length = 0;
  answers.set("GET /v1/jobs?kind=translate", { jobs: [] });
  answers.set("GET /v1/runs", { runs: [] });
});

test("a start posts the run, then follows the job it answers — on the strip as that language", async () => {
  const jobs = useJobsStore();
  answers.set("POST /v1/jobs", snapshot("j1", "es"));
  await jobs.start({ lang: "es", scope: "pending" });
  expect(calls[0]).toEqual(["POST", "/v1/jobs", { lang: "es", scope: "pending", keys: null, presetId: null }]);
  expect(follows.length).toBe(1);
  const { opts } = follows[0];
  expect(opts.feature).toBe("translate");
  expect(opts.meta).toEqual({ lang: "es" });
  expect(await opts.start()).toMatchObject({ id: "j1" });
  expect(jobs.running).toBe(true);
  // the strip's n/m readout from the job's own counts
  expect(opts.describe(snapshot("j1", "es", "running", { total: 40, done: 12 }), 30)).toBe("12/40");
  // its snapshots are the store's job
  opts.onJob(snapshot("j1", "es", "running", { total: 40, done: 20, scope: "pending" }));
  expect(jobs.run).toMatchObject({ lang: "es", scope: "pending", done: 20, total: 40, state: "running" });
});

test("the queue starts the next language when a run ends, and a cancel ends the queue", async () => {
  const jobs = useJobsStore();
  answers.set("POST /v1/jobs", (b) => snapshot(`j-${b.lang}`, b.lang));
  await jobs.startMany(["es", "fr", "de"], "pending");
  expect(follows[0].opts.label).toContain("·"); // "Translating Spanish · then French, German"
  follows[0].opts.onJob(snapshot("j-es", "es", "done"));
  follows[0].resolve(null);
  await settle();
  await settle();
  expect(calls.filter((c) => c[0] === "POST").map((c) => c[2].lang)).toEqual(["es", "fr"]);
  // the user cancels fr: de never starts
  follows[1].opts.onJob(snapshot("j-fr", "fr", "cancelled"));
  follows[1].reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
  await settle();
  await settle();
  expect(calls.filter((c) => c[0] === "POST").map((c) => c[2].lang)).toEqual(["es", "fr"]);
  expect(jobs.queue).toEqual([]);
});

test("a failed run still moves the queue on — its failure is on its own task's row", async () => {
  const jobs = useJobsStore();
  answers.set("POST /v1/jobs", (b) => snapshot(`j-${b.lang}`, b.lang));
  await jobs.startMany(["es", "fr"], "pending");
  follows[0].opts.onJob(snapshot("j-es", "es", "error"));
  follows[0].reject(Object.assign(new Error("engine offline"), { status: 500 }));
  await settle();
  await settle();
  expect(calls.filter((c) => c[0] === "POST").map((c) => c[2].lang)).toEqual(["es", "fr"]);
});

test("a reload rejoins the running job once; Cancel asks the server to stop it", async () => {
  const jobs = useJobsStore();
  answers.set("GET /v1/jobs?kind=translate", { jobs: [snapshot("j9", "es")] });
  await jobs.refresh();
  await jobs.refresh(); // Home and Runs both refresh: still one follow
  expect(follows.length).toBe(1);
  expect(jobs.running).toBe(true);
  answers.set("DELETE /v1/jobs/j9", snapshot("j9", "es"));
  await jobs.cancel();
  expect(calls.at(-1)).toEqual(["DELETE", "/v1/jobs/j9", undefined]);
});

test("after a reload the card reads the newest run record — how it ended and the keys it couldn't deliver", async () => {
  const jobs = useJobsStore();
  answers.set("GET /v1/runs", {
    runs: [
      { id: 2, lang: "es", scope: "all", total: 3, keys: 2, requests: 4, failed: 1, failedKeys: ["greet"], state: "done", error: null },
      { id: 1, lang: "es", scope: "all", keys: 3, requests: 1, failed: 0 },
    ],
  });
  await jobs.refresh();
  expect(jobs.run).toEqual({ lang: "es", scope: "all", total: 3, done: 2, requests: 4, failed: ["greet"], state: "done", phase: null, error: null });
  // a record from before the move (no state) shows no card
  answers.set("GET /v1/runs", { runs: [{ id: 1, lang: "es", scope: "all", keys: 3, requests: 1, failed: 0 }] });
  await jobs.refresh();
  expect(jobs.run).toBeNull();
});

test("the confirmation pass's events become their toasts", async () => {
  const jobs = useJobsStore();
  answers.set("POST /v1/jobs", snapshot("j1", "es"));
  await jobs.start({ lang: "es", scope: "pending" });
  follows[0].opts.onEvent({ type: "confirming", count: 3, lang: "es" });
  follows[0].opts.onEvent({ type: "confirm-error", message: "engine down" });
  const toasts = calls.filter((c) => c[0] === "TOAST").map((c) => c[1]);
  expect(toasts[0].message).toContain("3");
  expect(toasts[1]).toMatchObject({ kind: "error" });
  expect(toasts[1].description).toContain("engine down");
});
