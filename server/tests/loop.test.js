// SPDX-License-Identifier: MIT
// Port of tests/test_loop.py — the loop's orchestration, driven through a fake `send`, no
// model anywhere. The behaviours under test are the paid-for ones: the delta skip, the retry
// ladder ending in singletons, keys NEVER silently skipped, the per-batch flush that makes an
// interrupted hour resumable, and cancellation that only ever stops on a batch boundary.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { translateLanguage } from "../src/loop.js";
import { tmpDir } from "./helpers.js";

const CFG = {
  placeholder: { prefix: "{", suffix: "}" },
  pluralSeparator: "|",
  sourceLanguage: "en",
  context: "a test app",
  glossary: { doNotTranslate: [] },
};
const quiet = () => {};
const itemsOf = (user) => JSON.parse(/Translate items: (\[.*\])$/s.exec(user)[1]);
const plain = (m) => Object.fromEntries(m);

/** A well-behaved engine: returns every item 'translated' with shields intact. */
const echoSend = (_system, user) =>
  JSON.stringify({ items: itemsOf(user).map((it) => ({ id: it.id, translation: `XX ${it.text}` })) });

test("happy_path_translates_writes_cache_and_reports_counts", async () => {
  const cache = join(tmpDir(), "cache.json");
  const logs = [];
  const result = await translateLanguage({
    sourceFlat: { a: "Hello {name}", b: "Save" },
    lang: "es",
    cfg: CFG,
    cachePath: cache,
    send: echoSend,
    log: (l) => logs.push(l),
  });
  expect(plain(result.values)).toEqual({ a: "XX Hello {name}", b: "XX Save" });
  expect(result.failed).toEqual([]);
  expect(result.requests).toBe(1);
  expect(Object.keys(JSON.parse(readFileSync(cache, "utf8"))).length, "the cache was flushed").toBeGreaterThan(0);
  expect(logs.some((l) => l.includes("0 unchanged, 2 to translate"))).toBe(true);
});

test("the_delta_skips_only_when_target_exists_and_cache_agrees", async () => {
  const cache = join(tmpDir(), "cache.json");
  const first = await translateLanguage({ sourceFlat: { a: "Hello" }, lang: "es", cfg: CFG, cachePath: cache, send: echoSend, log: quiet });
  // Second run with the existing target + warm cache: no engine call at all.
  const calls = [];
  const countingSend = (system, user) => {
    calls.push(1);
    return echoSend(system, user);
  };
  const second = await translateLanguage({
    sourceFlat: { a: "Hello" },
    existingFlat: first.values,
    lang: "es",
    cfg: CFG,
    cachePath: cache,
    send: countingSend,
    log: quiet,
  });
  expect(second.requests).toBe(0);
  expect(calls).toEqual([]);
  expect(plain(second.values), "the existing translation is kept verbatim").toEqual(plain(first.values));

  // Changed SOURCE text -> new cache key -> re-translated even though a target exists.
  const third = await translateLanguage({
    sourceFlat: { a: "Hello there" },
    existingFlat: first.values,
    lang: "es",
    cfg: CFG,
    cachePath: cache,
    send: countingSend,
    log: quiet,
  });
  expect(third.requests).toBe(1);
});

test("a_lost_shield_token_is_a_failure_routed_to_retry_not_a_result", async () => {
  const attempts = [];
  const flakySend = (system, user) => {
    const items = itemsOf(user);
    attempts.push(items.length);
    if (attempts.length === 1) {
      // First reply loses the shield token on every item — must not be accepted.
      return JSON.stringify({ items: items.map((it) => ({ id: it.id, translation: "sin token" })) });
    }
    return echoSend(system, user);
  };
  const result = await translateLanguage({
    sourceFlat: { a: "Hi {n}" },
    lang: "es",
    cfg: CFG,
    cachePath: join(tmpDir(), "c.json"),
    send: flakySend,
    log: quiet,
  });
  expect(result.values.get("a"), "the retry recovered the key").toBe("XX Hi {n}");
  expect(result.requests).toBeGreaterThanOrEqual(2);
});

test("a_key_that_exhausts_every_retry_is_reported_never_silently_skipped", async () => {
  const alwaysBad = (_system, user) =>
    JSON.stringify({ items: itemsOf(user).map((it) => ({ id: it.id, translation: "" })) });
  const result = await translateLanguage({
    sourceFlat: { a: "Hello", b: "Bye" },
    lang: "es",
    cfg: CFG,
    cachePath: join(tmpDir(), "c.json"),
    send: alwaysBad,
    log: quiet,
  });
  // THE rule this project exists for: failed keys are NAMED, values do not contain them.
  expect([...result.failed].sort()).toEqual(["a", "b"]);
  expect(result.values.size).toBe(0);
});

test("singletons_isolate_one_pathological_string", async () => {
  const poisonB = (_system, user) =>
    JSON.stringify({
      items: itemsOf(user).map((it) => ({ id: it.id, translation: it.text.includes("Bye") ? "" : `XX ${it.text}` })),
    });
  const result = await translateLanguage({
    sourceFlat: { a: "Hello", b: "Bye" },
    lang: "es",
    cfg: CFG,
    cachePath: join(tmpDir(), "c.json"),
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
    cachePath: join(tmpDir(), "c.json"),
    send: echoSend,
    batchSize: 2,
    onBatch: (values) => flushes.push(values.size),
    log: quiet,
  });
  expect(flushes, "partial progress is written after EACH batch, not once at the end").toEqual([2, 4]);
});

test("cancellation_stops_on_a_batch_boundary_with_consistent_state", async () => {
  const seen = { batches: 0 };
  const sendAndCount = (system, user) => {
    seen.batches += 1;
    return echoSend(system, user);
  };
  const result = await translateLanguage({
    sourceFlat: Object.fromEntries([0, 1, 2, 3].map((i) => [`k${i}`, `word ${i}`])),
    lang: "es",
    cfg: CFG,
    cachePath: join(tmpDir(), "c.json"),
    send: sendAndCount,
    batchSize: 2,
    isCancelled: () => seen.batches >= 1,
    log: quiet,
  });
  expect(result.cancelled).toBe(true);
  expect(result.values.size, "the paid-for batch is kept, the next never started").toBe(2);
});

test("force_retranslates_but_never_wipes_other_cache_entries", async () => {
  const cache = join(tmpDir(), "c.json");
  await translateLanguage({ sourceFlat: { a: "Hello", b: "Bye" }, lang: "es", cfg: CFG, cachePath: cache, send: echoSend, log: quiet });
  const entriesBefore = Object.keys(JSON.parse(readFileSync(cache, "utf8"))).length;
  // Force ONE key: the other's cache entry must survive — force means "re-translate these
  // anyway", not "throw away what every other key already learned".
  await translateLanguage({ sourceFlat: { a: "Hello" }, lang: "es", cfg: CFG, cachePath: cache, send: echoSend, force: true, log: quiet });
  expect(Object.keys(JSON.parse(readFileSync(cache, "utf8"))).length).toBe(entriesBefore);
});
