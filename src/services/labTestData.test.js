// SPDX-License-Identifier: MIT
// The AI Lab's test input over a mocked kit transport: each prompt row (translate, confirm, review) has a picker
// over the project's languages, and picking one fills that row's variables from the server's live sample.
import { expect, test, vi } from "vitest";

const calls = [];
vi.mock("@delebash/ui", () => ({
  get: async (p) => {
    calls.push(p);
    if (p === "/v1/state") return { langs: ["es", "pt-BR"] };
    return { variables: { items: "[]", lang: "es" } };
  },
}));

const { LAB_TEST_ACTIONS, LAB_TEST_SOURCES } = await import("./labTestData.js");

test("the languages source lists the project's targets", async () => {
  const [langs] = LAB_TEST_SOURCES;
  expect(langs.id).toBe("langs");
  expect((await langs.list()).map((o) => o.id)).toEqual(["es", "pt-BR"]);
});

test("every prompt row's picker fills its own action's variables for the picked language", async () => {
  expect(Object.keys(LAB_TEST_ACTIONS)).toEqual(["translate", "confirm", "review"]);
  for (const [action, decl] of Object.entries(LAB_TEST_ACTIONS)) {
    const [picker] = decl.pickers;
    expect(picker.source).toBe("langs");
    calls.length = 0;
    expect(await picker.fill("pt-BR")).toEqual({ items: "[]", lang: "es" });
    expect(calls).toEqual([`/v1/ai/test-variables?action=${action}&lang=pt-BR`]);
  }
});
