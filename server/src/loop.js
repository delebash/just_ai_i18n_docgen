// SPDX-License-Identifier: MIT
// The translate loop — Layer 1's orchestration. Owned, on purpose. The port of loop.py
// (ported from just-ai-help's `server/loop.js` `translateLanguage`, with ONE structural
// change: the engine call is an injected async `send(variables) -> str` instead of a
// transport this module owns — the prompt is the translate row the variables fill
// (seed_feature_prompts.js), the body is owned by the kit's adapters and the per-feature
// engine preset, and THAT layer carries the probe's non-zero-temperature guard).
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
// generation, and a crash at minute 55 must not throw away 54 minutes — `onBatch` writes the
// partial result, so a resumed run finds those keys done.
//
// THE DELTA: a key that already has a translation is kept unless its English changed since that
// translation was made (`recorded`, sources.js — the English each translation was written for);
// `force` re-translates anyway. Until 2026-10-29 the delta asked a translation cache whose key held
// the project's context and glossary, so a changed context sentence re-translated — and the CLI
// wrote over — every reviewed string.

import { sleep } from "@delebash/core/platform/asyncutil";
import { errText, pyGet, strip, truthy } from "@delebash/core/platform/py";
import { asMap, placeholderRe } from "./jsonio.js";
import { parseItems, restore, shield, translateVariables } from "./shieldlib.js";

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
  recorded = null,
  send,
  force = false,
  batchSize = 16,
  rateLimitMs = 0,
  log = console.log,
  onBatch = null,
  isCancelled = null,
}) {
  const source = asMap(sourceFlat);
  const existing = asMap(truthy(existingFlat) ? existingFlat : null);
  const phRe = placeholderRe(cfg.placeholder);
  const gl = pyGet(cfg, "glossary");
  const dnt = pyGet(truthy(gl) ? gl : {}, "doNotTranslate");
  const terms = truthy(dnt) ? dnt : [];

  // the English each existing translation was made from (sources.js); null: none known
  const madeFrom = recorded ? asMap(recorded) : new Map();
  const values = new Map();
  const todo = [];

  for (const [key, text] of source) {
    // Nothing to translate: a blank source comes back as itself, with no engine call. Sent, it
    // came back empty and the key ended in `failed` — the kit's `kit.quickSetup.doneBody` is
    // "" on purpose (an app sets its own), 2026-10-15.
    if (!strip(text)) {
      values.set(key, text);
      continue;
    }
    if (!force && existing.has(key) && (!madeFrom.has(key) || madeFrom.get(key) === text)) {
      values.set(key, existing.get(key));
      continue;
    }
    todo.push({ key, text });
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
    // shielded BEFORE the row renders: the model sees ⟦n⟧ tokens, never a placeholder or a term
    const variables = translateVariables(shielded, cfg, lang, terms);

    const wait = rateLimitMs / 1000 - (monotonic() - lastCall);
    if (wait > 0) await sleep(wait * 1000);
    lastCall = monotonic();
    requests += 1;

    const items = parseItems(await send(variables));

    const stillMissing = [];
    for (const s of shielded) {
      const raw = items.get(s.i);
      const restored = raw === undefined ? null : restore(raw, s.tokens);
      if (restored === null || !strip(restored)) stillMissing.push(s);
      else {
        values.set(s.key, restored);
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
        // a setting no retry can fix (engine.js EngineNotConfigured) ends the run, named
        if (err?.fatal) throw err;
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
          if (err?.fatal) throw err;
          log(`  ${item.key}: ${errText(err)} (singleton ${tryNo}/2)`);
        }
      }
      if (!done) failed.push(item.key);
    }

    if (onBatch) onBatch(values);
    log(`  ${lang}: ${values.size}/${source.size} done (batch ${bi + 1}/${batches.length})`);
  }

  return { values, failed, requests, cancelled: false };
}
