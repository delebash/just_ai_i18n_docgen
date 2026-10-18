// SPDX-License-Identifier: MIT
// Language names follow the INTERFACE's language, not the window's: with Spanish chosen, Home,
// Review and Runs said "Spanish (es)" (2026-10-17).
import { afterEach, expect, test } from "vitest";
import { i18n } from "../i18n/index.js";
import { langLabel, langName, langTitle } from "./langs.js";

afterEach(() => {
  i18n.global.locale.value = "en";
});

test("names_follow_the_interface_language", () => {
  expect(langName("es")).toBe("Spanish");
  expect(langLabel("es")).toBe("Spanish (es)");
  i18n.global.locale.value = "es";
  expect(langName("es"), "inside a sentence, as Spanish writes it").toBe("español");
  expect(langTitle("es"), "standing on its own").toBe("Español");
  expect(langLabel("en")).toBe("Inglés (en)");
});

test("a_code_that_cannot_be_named_stays_the_code", () => {
  expect(langName("")).toBe("");
  expect(langLabel("zz-private-x")).toBe("zz-private-x");
});
