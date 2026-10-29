// SPDX-License-Identifier: MIT
// Every route that takes input, three ways (app-structure §18): its happy path, one 422 from its schema (§15 — the
// kit's problem+json, its `errors` naming the part and field), and one refusal the route decides. The project
// routes share one refusal — the 409 that sends the screen to Setup when no project is loaded — asked of each.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import * as workspaceApi from "../src/api/workspace_api.js";
import { createApp } from "../src/app.js";
import { EngineNotConfigured } from "../src/engine.js";
import { getState } from "../src/app_state.js";
import { putProposal } from "../src/state.js";
import { KEY_MAX, LANG_MAX, TEXT_MAX } from "../src/schemas/workspace.js";
import { testClient, tmpDir, until, useHermeticKit } from "./helpers.js";

useHermeticKit();

const EN = { greet: "Hello {name}", sidebar: { books: "Books" }, common: { no: "No" } };

function makeProject(root) {
  const appDir = join(root, "myapp");
  mkdirSync(join(appDir, "src", "locales"), { recursive: true });
  writeFileSync(join(appDir, "package.json"), "{}", "utf8");
  writeFileSync(join(appDir, "src", "locales", "en.json"), JSON.stringify(EN), "utf8");
  writeFileSync(join(appDir, "src", "locales", "es.json"), JSON.stringify({ greet: "Hola {name}", sidebar: { books: "Libros" } }), "utf8");
  mkdirSync(join(appDir, "just-ai-i18n-docgen"));
  const config = join(appDir, "just-ai-i18n-docgen", "config.json");
  writeFileSync(config, JSON.stringify({ source: "../src/locales/en.json", targets: ["es"], context: "a test app" }), "utf8");
  return config;
}

let root;
let client;
let configPath;
beforeEach(async () => {
  root = tmpDir();
  configPath = makeProject(root);
  client = testClient(await createApp(join(root, "data"), configPath));
});

const tooLong = (n) => "x".repeat(n + 1);

/** A 422 in the family's shape, its first error at `loc`. */
function expect422(r, loc) {
  expect(r.statusCode, JSON.stringify(r.json())).toBe(422);
  const body = r.json();
  expect(body.status).toBe(422);
  expect(body.type).toMatch(/validation-error$/);
  expect(typeof body.requestId).toBe("string");
  expect(body.errors[0].loc).toEqual(loc);
}

/** A refusal in the family's shape. */
function expectRefusal(r, status, slug) {
  expect(r.statusCode, JSON.stringify(r.json())).toBe(status);
  expect(r.json().type).toMatch(new RegExp(`${slug}$`));
  expect(typeof r.json().detail).toBe("string");
}

// [method, path, a good request, a request its schema refuses, where the schema says it failed, whether the good one
// runs here (an AI route's happy path needs its engine faked — its own test below)]
const PROJECT_ROUTES = [
  ["GET", "/v1/ai/test-variables", { params: { action: "translate", lang: "es" } }, { params: { lang: "es" } }, ["query", "action"]],
  ["GET", "/v1/rows", { params: { lang: "es" } }, { params: { lang: tooLong(LANG_MAX) } }, ["query", "lang"]],
  ["GET", "/v1/accepted", { params: { lang: "es" } }, { params: { lang: tooLong(LANG_MAX) } }, ["query", "lang"]],
  ["POST", "/v1/save", { json: { lang: "es", key: "common.no", value: "No." } }, { json: { lang: "es", key: "common.no", value: tooLong(TEXT_MAX) } }, ["body", "value"]],
  ["POST", "/v1/accept", { json: { lang: "es", keys: ["greet"] } }, { json: { lang: "es", keys: "greet" } }, ["body", "keys"]],
  ["DELETE", "/v1/accept", { json: { lang: "es", key: "greet" } }, { json: { lang: "es" } }, ["body", "key"]],
  ["GET", "/v1/history", { params: { lang: "es" } }, { params: { lang: tooLong(LANG_MAX) } }, ["query", "lang"]],
  ["GET", "/v1/proposals", { params: { lang: "es" } }, { params: { key: tooLong(KEY_MAX) } }, ["query", "key"]],
  ["POST", "/v1/proposals/apply", { json: { lang: "es", keys: [] } }, { json: { lang: "es" } }, ["body", "keys"]],
  ["DELETE", "/v1/proposals", { json: { lang: "es" } }, { json: { lang: "es", every: true } }, ["body", "every"]],
  ["GET", "/v1/siblings", { params: { key: "sidebar.books" } }, { params: {} }, ["query", "key"]],
  ["GET", "/v1/terms", { params: { term: "Books" } }, { params: { key: tooLong(KEY_MAX) } }, ["query", "key"]],
  ["PUT", "/v1/notes", { json: { lang: "es", key: "greet", note: "a greeting" } }, { json: { lang: "es", key: "greet", note: tooLong(TEXT_MAX) } }, ["body", "note"]],
  ["GET", "/v1/runs", { params: { lang: "es" } }, { params: { lang: tooLong(LANG_MAX) } }, ["query", "lang"]],
  ["GET", "/v1/reference", { params: { key: "greet" } }, { params: {} }, ["query", "key"]],
  ["POST", "/v1/backtranslate", { json: { lang: "es", key: "greet" } }, { json: { lang: "es" } }, ["body", "key"], false],
  ["POST", "/v1/jobs", { json: { lang: "es", scope: "all" } }, { json: { lang: "es", scope: "everything" } }, ["body", "scope"], false],
];

test.each(PROJECT_ROUTES)("%s %s: works, its schema's 422, and the 409 with no project", async (method, path, good, bad, loc, happy = true) => {
  if (happy) {
    const r = await client.request(method, path, good);
    expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
  }
  expect422(await client.request(method, path, bad), loc);

  // no project loaded: the refusal that sends the screen to Setup
  const bare = testClient(await createApp(join(tmpDir(), "data")));
  const r = await bare.request(method, path, good);
  expectRefusal(r, 409, "needs-setup");
  expect(r.json().needsSetup).toBe(true);
});

test("save, accept and undo refuse what isn't there", async () => {
  expectRefusal(await client.post("/v1/save", { json: { lang: "es", key: "nope", value: "x" } }), 404, "not-found");
  expectRefusal(await client.post("/v1/accept", { json: { lang: "es", keys: ["nope"] } }), 404, "not-found");
  // a key or keys[] — neither is a 422 under keys, in words
  expect422(await client.post("/v1/accept", { json: { lang: "es" } }), ["body", "keys"]);
  expectRefusal(await client.post("/v1/undo", { json: { lang: "es" } }), 404, "not-found");
  expect422(await client.post("/v1/undo", { json: { lang: 7 } }), ["body", "lang"]);
  // and the happy undo: an edit, then its undo
  await client.post("/v1/save", { json: { lang: "es", key: "common.no", value: "No." } });
  expect((await client.post("/v1/undo", { json: { lang: "es" } })).json().undone.kind).toBe("edit");
});

test("a staged value applies and discards; terms need a key or a term", async () => {
  const p = getState().workspace.project;
  putProposal(p.state, { lang: "es", key: "common.no", engine: "e", value: "No." });
  expect((await client.post("/v1/proposals/apply", { json: { lang: "es", keys: ["common.no"] } })).json().applied).toEqual(["common.no"]);
  putProposal(p.state, { lang: "es", key: "common.no", engine: "e", value: "Nop" });
  expect((await client.delete("/v1/proposals", { json: { lang: "es", keys: ["common.no"] } })).json().discarded).toBe(1);
  expect422(await client.get("/v1/terms", { params: { lang: "es" } }), ["query", "key"]);
});

test("the Lab's test input refuses a language the project doesn't have", async () => {
  expectRefusal(await client.get("/v1/ai/test-variables", { params: { action: "translate", lang: "xx" } }), 400, "bad-request");
});

test("backtranslate: its answer, the missing translation, and the engine's failures said by kind", async () => {
  const answer = vi.spyOn(workspaceApi, "makeSend").mockImplementation(() => async () =>
    JSON.stringify({ items: [{ id: 0, translation: "Hello {name}" }] }),
  );
  const r = await client.post("/v1/backtranslate", { json: { lang: "es", key: "greet" } });
  expect(r.json()).toMatchObject({ english: "Hello {name}", cached: false });
  expectRefusal(await client.post("/v1/backtranslate", { json: { lang: "es", key: "common.no" } }), 404, "not-found");
  answer.mockRestore();

  const failWith = (e) => vi.spyOn(workspaceApi, "makeSend").mockImplementation(() => async () => { throw e; });
  // the local model not ready: the kit's 503, its own title
  failWith(Object.assign(new EngineNotConfigured("the model is still loading"), { localNotReady: true }));
  let f = await client.post("/v1/backtranslate", { json: { lang: "es", key: "sidebar.books" } });
  expectRefusal(f, 503, "engine-not-ready");
  // an engine the user has to set up: a 400 in words
  failWith(new EngineNotConfigured('feature "review" resolves to no engine preset'));
  f = await client.post("/v1/backtranslate", { json: { lang: "es", key: "sidebar.books" } });
  expectRefusal(f, 400, "engine-not-configured");
  expect(f.json().detail).toContain("no engine preset");
  // a provider that can't be reached: the kit's 502
  failWith(Object.assign(new Error("connect ECONNREFUSED"), { unreachable: true }));
  expectRefusal(await client.post("/v1/backtranslate", { json: { lang: "es", key: "sidebar.books" } }), 502, "provider-unreachable");
  // a reply that isn't usable: a 502 of docgen's own
  vi.spyOn(workspaceApi, "makeSend").mockImplementation(() => async () => "not json at all");
  expectRefusal(await client.post("/v1/backtranslate", { json: { lang: "es", key: "sidebar.books" } }), 502, "engine-answer-unusable");
});

test("a run: started, an unknown language under its field, nothing selected, and no engine", async () => {
  vi.spyOn(workspaceApi, "makeSend").mockImplementation(() => async (vars) =>
    JSON.stringify({ items: JSON.parse(vars.items).map((it) => ({ id: it.id, translation: `NUEVO ${it.text}` })) }),
  );
  expect422(await client.post("/v1/jobs", { json: { lang: "fr", scope: "all" } }), ["body", "lang"]);
  // flagged on a language whose translations are all clean selects nothing — said, not started
  writeFileSync(join(dirname(dirname(configPath)), "src", "locales", "es.json"), JSON.stringify({ greet: "Hola {name}", sidebar: { books: "Libros" }, common: { no: "Nop" } }), "utf8");
  expectRefusal(await client.post("/v1/jobs", { json: { lang: "es", scope: "keys", keys: [] } }), 400, "nothing-selected");
  const r = await client.post("/v1/jobs", { json: { lang: "es", scope: "all" } });
  expect(r.statusCode).toBe(202);
  const { jobs } = getState();
  await until(() => jobs.get(r.json().id).state !== "running");

  vi.spyOn(workspaceApi, "makeSend").mockImplementation(() => {
    throw new EngineNotConfigured('feature "translate" resolves to no engine preset');
  });
  expectRefusal(await client.post("/v1/jobs", { json: { lang: "es", scope: "all" } }), 400, "engine-not-configured");
});

test("the Google Translate frame: its page, and its schema's 422", async () => {
  const r = await client.get("/v1/gt-frame", { params: { text: "Hola", tl: "es" } });
  expect(r.statusCode).toBe(200);
  expect422(await client.get("/v1/gt-frame", { params: { text: tooLong(TEXT_MAX) } }), ["query", "text"]);
});

test("setup: inspect and save, a path the server can't use said under the path box", async () => {
  const enPath = join(dirname(dirname(configPath)), "src", "locales", "en.json");
  expect((await client.post("/v1/setup/inspect", { json: { path: enPath } })).json().keyCount).toBe(3);
  expect422(await client.post("/v1/setup/inspect", { json: { path: "" } }), ["body", "path"]);
  // quotes and spaces only: the route's own "missing", under the field
  const blank = await client.post("/v1/setup/inspect", { json: { path: ' "" ' } });
  expect422(blank, ["body", "path"]);
  expect(blank.json().errors[0].type).toBe("missing");
  const gone = await client.post("/v1/setup/inspect", { json: { path: join(root, "nowhere", "en.json") } });
  expect422(gone, ["body", "path"]);

  expect((await client.post("/v1/setup/save", { json: { path: enPath, context: "a test app, saved" } })).json().ok).toBe(true);
  expect422(await client.post("/v1/setup/save", { json: { path: enPath, targets: "es" } }), ["body", "targets"]);
  expect422(await client.post("/v1/setup/save", { json: { path: join(root, "nowhere", "en.json") } }), ["body", "path"]);
});

test("the reviewer: a name, none, and a name that isn't text", async () => {
  expect((await client.put("/v1/reviewer", { json: { reviewer: "Ana" } })).json().reviewer).toBe("Ana");
  expect((await client.put("/v1/reviewer", { json: { reviewer: null } })).json().reviewer).toBeNull();
  expect422(await client.put("/v1/reviewer", { json: { reviewer: 7 } }), ["body", "reviewer"]);
  expect422(await client.put("/v1/reviewer", { json: {} }), ["body", "reviewer"]);
});
