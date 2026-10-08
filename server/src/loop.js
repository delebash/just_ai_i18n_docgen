// SPDX-License-Identifier: MIT
// The translate loop — Layer 1's orchestration. Owned, on purpose. The port of loop.py
// (ported from just-ai-help's `server/loop.js` `translateLanguage`, with ONE structural
// change: the engine call is an injected async `send(system, user) -> str` instead of a
// transport this module owns — the body is owned by llm-runner's adapters and the
// per-feature engine preset, and THAT layer carries the probe's non-zero-temperature guard).
//
// Everything else ports faithfully, because every rule was paid for:
//
// RETRY LADDER, and the last rung is the important one: batch ×3, then the batch's items as
// singletons ×2, then the key is LEFT UNTRANSLATED and reported. Never silently skipped —
// that exact bug ("exits 0 even when it skipped keys") is why this project exists.
//
// A key counts as delivered only when every shield token came back exactly once — a
// translation that lost a placeholder is a FAILURE routed to retry, not a result.
//
// FLUSH after every batch, not once at the end: a full catalogue is an hour of local
// generation, and a crash at minute 55 must not throw away 54 minutes. Both halves are
// needed — the cache alone resumes nothing, because the delta skips a key only when the
// cache entry AND the existing target value are present, so `onBatch` writes the partial
// locale file.
//
// The cache is ALWAYS loaded, even under force: force means "re-translate these keys
// anyway", not "throw away what every other key and language already learned".

import { sleep } from "@delebash/llm-runner/platform/asyncutil";
import { FileNotFoundError, ValueError } from "@delebash/llm-runner/platform/py";
import { asMap, dget, dumps, errText, isDict, OSError, placeholderRe, pyStrip, pyTruthy, readJson, toPlain, writeText } from "./jsonio.js";
import { exists } from "./paths.js";
import { buildSystemPrompt, buildUserMessage, cacheKey, parseItems, restore, sha1, shield } from "./shieldlib.js";

function loadCache(p) {
  if (!exists(p)) return {};
  try {
    const c = toPlain(readJson(p));
    // A cache is a {key: translation} dict; anything else is as good as corrupt.
    return isDict(c) ? c : {};
  } catch (e) {
    if (e instanceof ValueError || e instanceof OSError || e instanceof FileNotFoundError) return {};
    throw e; // (a corrupt cache costs a re-run, never a wrong answer)
  }
}

const monotonic = () => performance.now() / 1000;

/**
 * Translates one language through the injected engine seam.
 *
 * Returns {values: Map, failed: [...], requests, cancelled}. Cancellation is checked on batch
 * boundaries, never inside one — a batch in flight has been paid for, and stopping on a
 * boundary keeps the same guarantee the crash-resume path has: whatever is in `values` is
 * complete and consistent. `sourceFlat` / `existingFlat` are Maps (or plain objects).
 */
export async function translateLanguage({
  sourceFlat,
  existingFlat = null,
  lang,
  cfg,
  cachePath,
  send,
  force = false,
  batchSize = 16,
  rateLimitMs = 0,
  log = console.log,
  onBatch = null,
  isCancelled = null,
}) {
  const source = asMap(sourceFlat);
  const existing = asMap(pyTruthy(existingFlat) ? existingFlat : null);
  const phRe = placeholderRe(cfg.placeholder);
  const ctx = dget(cfg, "context");
  const contextHash = sha1(pyTruthy(ctx) ? ctx : "");
  const gl = dget(cfg, "glossary");
  const glossaryHash = sha1(dumps(pyTruthy(gl) ? gl : {}, { sortKeys: true }));
  const dnt = dget(pyTruthy(gl) ? gl : {}, "doNotTranslate");
  const terms = pyTruthy(dnt) ? dnt : [];
  const system = buildSystemPrompt({
    source: dget(cfg, "sourceLanguage", "en"),
    targetLang: lang,
    doNotTranslate: terms,
    conventionsLine: dget(cfg, "conventionsLine", ""),
    pluralSeparator: dget(cfg, "pluralSeparator"),
  });

  const cache = loadCache(cachePath);
  const values = new Map();
  const todo = [];

  for (const [key, text] of source) {
    const ck = cacheKey({ text, lang, contextHash, glossaryHash });
    if (!force && existing.has(key) && Object.hasOwn(cache, ck)) {
      values.set(key, existing.get(key));
      continue;
    }
    todo.push({ key, text, ck });
  }

  log(`${lang}: ${source.size - todo.length} unchanged, ${todo.length} to translate`);
  if (!todo.length) return { values, failed: [], requests: 0, cancelled: false };

  const batches = [];
  for (let i = 0; i < todo.length; i += batchSize) batches.push(todo.slice(i, i + batchSize));
  const failed = [];
  let requests = 0;
  let lastCall = 0.0;

  /** Sends one group; returns the items it could not deliver. A key counts as delivered only
   * when the shield tokens all came back. */
  const attempt = async (group) => {
    const shielded = group.map((it, i) => {
      const [sh, tokens] = shield(it.text, phRe, terms);
      return { ...it, i, shielded: sh, tokens };
    });
    const user = buildUserMessage(shielded, cfg);

    const wait = rateLimitMs / 1000 - (monotonic() - lastCall);
    if (wait > 0) await sleep(wait * 1000);
    lastCall = monotonic();
    requests += 1;

    const items = parseItems(await send(system, user));

    const stillMissing = [];
    for (const s of shielded) {
      const raw = items.get(s.i);
      const restored = raw === undefined ? null : restore(raw, s.tokens);
      if (restored === null || !pyStrip(restored)) stillMissing.push(s);
      else {
        values.set(s.key, restored);
        cache[s.ck] = restored;
      }
    }
    return stillMissing;
  };

  for (let bi = 0; bi < batches.length; bi++) {
    if (isCancelled?.()) {
      log(`  ${lang}: cancelled after ${bi} of ${batches.length} batch(es)`);
      return { values, failed, requests, cancelled: true };
    }

    let pending = batches[bi];
    for (let tryNo = 1; tryNo < 4; tryNo++) {
      if (!pending.length) break;
      try {
        pending = await attempt(pending);
        if (pending.length) log(`  batch ${bi + 1}: ${pending.length} item(s) unresolved, retry ${tryNo}/3`);
      } catch (err) {
        // an engine error is data for the ladder
        log(`  batch ${bi + 1}: ${errText(err)} (attempt ${tryNo}/3)`);
        if (tryNo === 3) break;
        await sleep(tryNo * 1000);
      }
    }

    // Singletons: a batch that keeps failing is usually ONE pathological string, and sending
    // it alone both isolates it and gives the model the whole budget for it.
    for (const item of pending) {
      let done = false;
      for (let tryNo = 1; tryNo < 3; tryNo++) {
        if (done) break;
        try {
          done = (await attempt([item])).length === 0;
        } catch (err) {
          log(`  ${item.key}: ${errText(err)} (singleton ${tryNo}/2)`);
        }
      }
      if (!done) failed.push(item.key);
    }

    writeText(cachePath, dumps(cache, { indent: 2, ensureAscii: false }));
    if (onBatch) onBatch(values);
    log(`  ${lang}: ${values.size}/${source.size} done (batch ${bi + 1}/${batches.length})`);
  }

  return { values, failed, requests, cancelled: false };
}
