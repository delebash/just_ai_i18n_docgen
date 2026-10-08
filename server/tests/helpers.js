// SPDX-License-Identifier: MIT
// Test helpers shared by docgen's suites (Python's fixtures).
//
// HERMETICITY (Python's `monkeypatch.setattr(lifecycle, "_service", None)` +
// `monkeypatch.setattr(seed, "_APP", dict(seed._APP))`): createApp boots the whole kit, which
// mutates process singletons — the runner service, the seed registration, the usage ledger —
// and the JS installLlm also awaits hardware detection and registers this app's cache in the
// family registry. `useHermeticKit()` snapshots and restores those, answers detection with a
// fake box (no nvidia-smi), answers the RAM-bandwidth probe "unmeasurable", and points
// JUST_AI_HOME and the user cache at a temp folder — nothing reads or writes the real
// registry (the kit's install_llm test does the same).
//
// `testClient(app)` stands in for Starlette's TestClient: requests come from a non-loopback
// address (TestClient's "testclient" host — so the auth gate bites) with `Host: testserver`
// (so a same-origin `Origin: http://testserver` is the server's own).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as seed from "@delebash/llm-runner/llm/seed";
import { getLedger, setLedger } from "@delebash/llm-runner/llm/usage";
import { model } from "@delebash/llm-runner/platform/models";
import * as bandwidth from "@delebash/llm-runner/runner/bandwidth";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import * as lifecycle from "@delebash/llm-runner/runner/lifecycle";
import { HardwareInfo } from "@delebash/llm-runner/runner/schema";
import { afterEach, beforeEach, vi } from "vitest";

export const tmpDir = (prefix = "docgen-test-") => mkdtempSync(join(tmpdir(), prefix));

export const fakeHw = () =>
  model(HardwareInfo, {
    os: "Linux",
    platform: "linux",
    cpuCores: 8,
    ramMb: 32000,
    gpus: [{ vendor: "nvidia", name: "Test", vramMb: 8192 }],
    runtimes: { cuda: true },
  });

/** Register beforeEach/afterEach that keep the kit's singletons per-test. */
export function useHermeticKit() {
  let saved;
  beforeEach(() => {
    saved = {
      service: lifecycle.state.service,
      app: seed.cfg._APP,
      ledger: getLedger(),
      hw: hardware.memo.hw,
    };
    lifecycle.state.service = null;
    seed.cfg._APP = { ...seed.cfg._APP };
    const t = tmpDir("docgen-kit-");
    vi.stubEnv("JUST_AI_HOME", join(t, "family"));
    vi.stubEnv("LLM_RUNNER_CACHE", join(t, "user-cache"));
    const box = fakeHw();
    hardware.setDetected(box);
    vi.spyOn(hardware, "detect").mockImplementation(async () => box);
    vi.spyOn(bandwidth, "probeRamCopyGbps").mockResolvedValue(null);
  });
  afterEach(() => {
    lifecycle.state.service = saved.service;
    seed.cfg._APP = saved.app;
    setLedger(saved.ledger);
    hardware.memo.hw = saved.hw;
  });
}

/** Starlette's TestClient, over `app.inject`. Each verb takes (url, {json, params, headers}). */
export function testClient(app) {
  const call =
    (method) =>
    (url, { json, params, headers } = {}) => {
      const qs = params ? `?${new URLSearchParams(params)}` : "";
      return app.inject({
        method,
        url: url + qs,
        headers: { host: "testserver", ...(headers || {}) },
        remoteAddress: "192.0.2.10",
        ...(json !== undefined ? { payload: json } : {}),
      });
    };
  return {
    app,
    get: call("GET"),
    post: call("POST"),
    put: call("PUT"),
    patch: call("PATCH"),
    delete: call("DELETE"),
    request: (method, url, opts) => call(method)(url, opts),
  };
}

/** Wait (polling) until `cond()` holds — Python's busy-wait on a thread's progress. */
export async function until(cond, timeoutMs = 10000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}
