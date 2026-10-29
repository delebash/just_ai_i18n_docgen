// SPDX-License-Identifier: MIT
// Screenshot capture — drives the REAL desktop app (Electron, the built UI from app://) through every surface and saves
// PNGs of its real rendering into e2e/shots/ (gitignored). `npm run screenshots` from the app's root (app-structure
// §10); the template's capture-direct.js, with this app's surfaces.
//
// Hermetic like the smoke (lib/driver.js): a temp data folder, the harness's own server, the shell's
// JUST_AI_I18N_DOCGEN_DEV_NO_SERVER=1, and the suite's own project (lib/fixture.js) — the shots never show or change
// your own data. Your real project in the real window is the acceptance walk (e2e/README.md).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Driver } from "./lib/driver.js";
import { loadFixture } from "./lib/fixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "shots");

const SURFACES = [
  { name: "home", hash: "#/", ready: ".dash" },
  { name: "setup", hash: "#/setup" },
  { name: "review", hash: "#/review?lang=es", ready: ".rrow" },
  { name: "runs", hash: "#/runs" },
  { name: "docs", hash: "#/docs" },
  { name: "ai", hash: "#/ai" },
  { name: "settings-general", hash: "#/settings/general" },
  { name: "settings-appearance", hash: "#/settings/appearance" },
  { name: "settings-reviewer", hash: "#/settings/reviewer" },
  { name: "settings-backups", hash: "#/settings/backups" },
  { name: "settings-storage", hash: "#/settings/storage" },
  { name: "settings-server", hash: "#/settings/server" },
  { name: "settings-logs", hash: "#/settings/logs" },
  { name: "settings-about", hash: "#/settings/about" },
  { name: "not-found", hash: "#/no-such-page" },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const d = new Driver();
  console.log("→ starting the server and the desktop app (hermetic)");
  await d.startServer();
  await loadFixture(d);
  await d.launch();
  await d.maximize();
  await d.page.waitForSelector(".shell", { timeout: 30_000 });
  try {
    for (const s of SURFACES) {
      console.log(`→ ${s.name} (${s.hash})`);
      await d.navigate(s.hash);
      if (s.ready) await d.page.waitForSelector(s.ready, { timeout: 10_000 });
      await d.page.waitForLoadState("networkidle").catch(() => {});
      await d.page.waitForTimeout(600); // let transitions settle before the picture
      await d.screenshot(path.join(OUT_DIR, `${s.name}.png`));
    }
    // the Quick Setup wizard, open — a dialog never shows in a route's shot; opened, never run (Apply starts a real
    // engine install and a multi-GB download)
    console.log("→ quicksetup (dialog, opened not run)");
    await d.navigate("#/ai");
    await d.page.getByRole("button", { name: /Run Quick Setup|Re-run Quick Setup/i }).click();
    await d.page.waitForSelector("[role=dialog]");
    await d.page.waitForTimeout(1200);
    await d.screenshot(path.join(OUT_DIR, "quicksetup.png"));
  } finally {
    console.log("→ closing");
    await d.close();
  }
  console.log(`done — ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
