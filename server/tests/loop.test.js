// SPDX-License-Identifier: MIT
// Port of tests/test_loop.py — the loop's orchestration, driven through a fake `send`, no
// model anywhere. The behaviours under test are the paid-for ones: the delta skip, the retry
// ladder ending in singletons, keys NEVER silently skipped, the per-batch flush that makes an
// interrupted hour resumable, and cancellation that only ever stops on a batch boundary.
import { expect, test } from "vitest";
import { translateLanguage } from "../src/loop.js";

const CFG = {
  placeholder: { prefix: "{", suffix: "}" },
  pluralSeparator: "|",
  sourceLanguage: "en",
  context: "a test app",
  glossary: { doNotTranslate: [] },
};
const quiet = () => {};
// the batch the loop sends: the translate row's {{items}} (shieldlib.js translateVariables)
const itemsOf = (vars) => JSON.parse(vars.items);
const plain = (m) => Object.fromEntries(m);

/** A well-behaved engine: returns every item 'translated' with shields intact. */
const echoSend = (vars) =>
  JSON.stringify({ items: itemsOf(vars).map((it) => ({ id: it.id, translation: `XX ${it.text}` })) });

test("happy_path_translates_and_reports_counts", async () => {
  const logs = [];
  const result = await translateLanguage({
    sourceFlat: { a: "Hello {name}", b: "Save" },
    lang: "es",
    cfg: CFG,
    send: echoSend,
    log: (l) => logs.push(l),
  });
  expect(plain(result.values)).toEqual({ a: "XX Hello {name}", b: "XX Save" });
  expect(result.failed).toEqual([]);
  expect(result.requests).toBe(1);
  expect(logs.some((l) => l.includes("0 unchanged, 2 to translate"))).toBe(true);
});

test("the_delta_keeps_a_translation_unless_its_recorded_english_changed", async () => {
  const first = await translateLanguage({ sourceFlat: { a: "Hello" }, lang: "es", cfg: CFG, send: echoSend, log: quiet });
  // Second run with the existing target, made from this English: no engine call at all.
  const calls = [];
  const countingSend = (vars) => {
    calls.push(1);
    return echoSend(vars);
  };
  const second = await translateLanguage({
    sourceFlat: { a: "Hello" },
    existingFlat: first.values,
    lang: "es",
    cfg: CFG,
    recorded: { a: "Hello" },
    send: countingSend,
    log: quiet,
  });
  expect(second.requests).toBe(0);
  expect(calls).toEqual([]);
  expect(plain(second.values), "the existing translation is kept verbatim").toEqual(plain(first.values));

  // A changed CONTEXT or glossary keeps it: a reviewed translation is never re-sent for that (the
  // CLI used to write over every reviewed string when the context sentence changed, 2026-10-29)
  const otherContext = await translateLanguage({
    sourceFlat: { a: "Hello" },
    existingFlat: first.values,
    lang: "es",
    cfg: { ...CFG, context: "a different sentence", glossary: { doNotTranslate: ["Hello"] } },
    recorded: { a: "Hello" },
    send: countingSend,
    log: quiet,
  });
  expect(otherContext.requests).toBe(0);

  // Its English changed since that translation was made -> re-translated even though a target exists.
  const third = await translateLanguage({
    sourceFlat: { a: "Hello there" },
    existingFlat: first.values,
    lang: "es",
    cfg: CFG,
    recorded: { a: "Hello" },
    send: countingSend,
    log: quiet,
  });
  expect(third.requests).toBe(1);
  expect(plain(third.values)).toEqual({ a: "XX Hello there" });

  // No record yet (translated before docgen recorded it): taken as current, kept.
  const unknown = await translateLanguage({ sourceFlat: { a: "Hello there" }, existingFlat: first.values, lang: "es", cfg: CFG, send: countingSend, log: quiet });
  expect(unknown.requests).toBe(0);
});

test("a_lost_shield_token_is_a_failure_routed_to_retry_not_a_result", async () => {
  const attempts = [];
  const flakySend = (vars) => {
    const items = itemsOf(vars);
    attempts.push(items.length);
    if (attempts.length === 1) {
      // First reply loses the shield token on every item — must not be accepted.
      return JSON.stringify({ items: items.map((it) => ({ id: it.id, translation: "sin token" })) });
    }
    return echoSend(vars);
  };
  const result = await translateLanguage({
    sourceFlat: { a: "Hi {n}" },
    lang: "es",
    cfg: CFG,
    send: flakySend,
    log: quiet,
  });
  expect(result.values.get("a"), "the retry recovered the key").toBe("XX Hi {n}");
  expect(result.requests).toBeGreaterThanOrEqual(2);
});

test("a_key_that_exhausts_every_retry_is_reported_never_silently_skipped", async () => {
  const alwaysBad = (vars) =>
    JSON.stringify({ items: itemsOf(vars).map((it) => ({ id: it.id, translation: "" })) });
  const result = await translateLanguage({
    sourceFlat: { a: "Hello", b: "Bye" },
    lang: "es",
    cfg: CFG,
    send: alwaysBad,
    log: quiet,
  });
  // THE rule this project exists for: failed keys are NAMED, values do not contain them.
  expect([...result.failed].sort()).toEqual(["a", "b"]);
  expect(result.values.size).toBe(0);
});

test("singletons_isolate_one_pathological_string", async () => {
  const poisonB = (vars) =>
    JSON.stringify({
      items: itemsOf(vars).map((it) => ({ id: it.id, translation: it.text.includes("Bye") ? "" : `XX ${it.text}` })),
    });
  const result = await translateLanguage({
    sourceFlat: { a: "Hello", b: "Bye" },
    lang: "es",
    cfg: CFG,
    send: poisonB,
    log: quiet,
  });
  expect(plain(result.values), "the good key is delivered").toEqual({ a: "XX Hello" });
  expect(result.failed, "the bad one is isolated and named").toEqual(["b"]);
});

test("on_batch_flushes_after_every_batch_so_a_crash_resumes", async () => {
  const flushes = [];
  await translateLanguage({
    sourceFlat: Object.fromEntries([0, 1, 2, 3].map((i) => [`k${i}`, `word ${i}`])),
    lang: "es",
    cfg: CFG,
    send: echoSend,
    batchSize: 2,
    onBatch: (values) => flushes.push(values.size),
    log: quiet,
  });
  expect(flushes, "partial progress is written after EACH batch, not once at the end").toEqual([2, 4]);
});

test("cancellation_stops_on_a_batch_boundary_with_consistent_state", async () => {
  const seen = { batches: 0 };
  const sendAndCount = (vars) => {
    seen.batches += 1;
    return echoSend(vars);
  };
  const result = await translateLanguage({
    sourceFlat: Object.fromEntries([0, 1, 2, 3].map((i) => [`k${i}`, `word ${i}`])),
    lang: "es",
    cfg: CFG,
    send: sendAndCount,
    batchSize: 2,
    isCancelled: () => seen.batches >= 1,
    log: quiet,
  });
  expect(result.cancelled).toBe(true);
  expect(result.values.size, "the paid-for batch is kept, the next never started").toBe(2);
});

test("force_retranslates_a_key_whose_english_is_unchanged", async () => {
  const first = await translateLanguage({ sourceFlat: { a: "Hello" }, lang: "es", cfg: CFG, send: echoSend, log: quiet });
  const forced = await translateLanguage({ sourceFlat: { a: "Hello" }, existingFlat: first.values, recorded: { a: "Hello" }, lang: "es", cfg: CFG, send: echoSend, force: true, log: quiet });
  expect(forced.requests).toBe(1);
});

test("a_blank_source_comes_back_as_itself_without_the_engine", async () => {
  // 2026-10-15: the kit's `kit.quickSetup.doneBody` is "" on purpose; sent, it came back empty
  // and ended in `failed`. Nothing to translate counts as done.
  const sent = [];
  const result = await translateLanguage({
    sourceFlat: { empty: "", spaces: "  ", a: "Hello" },
    lang: "es",
    cfg: CFG,
    send: (vars) => {
      sent.push(...itemsOf(vars).map((it) => it.text));
      return echoSend(vars);
    },
    log: quiet,
  });
  expect(plain(result.values)).toEqual({ empty: "", spaces: "  ", a: "XX Hello" });
  expect(result.failed).toEqual([]);
  expect(sent, "only the string with words reached the engine").toEqual(["Hello"]);
});

test("a_setting_no_retry_can_fix_ends_the_run_at_the_first_call", async () => {
  // engine.js EngineNotConfigured is `fatal`: the ladder (×3, then singletons ×2, each with a wait)
  // isn't spent on it — before 2026-10-29 an unconfigured engine failed every key that way
  let calls = 0;
  const fatalSend = () => {
    calls += 1;
    throw Object.assign(new Error("no engine preset"), { fatal: true });
  };
  const err = await translateLanguage({ sourceFlat: { a: "Hello", b: "Bye" }, lang: "es", cfg: CFG, send: fatalSend, log: quiet }).catch((e) => e);
  expect(err.message).toBe("no engine preset");
  expect(calls).toBe(1);
});
