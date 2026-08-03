// Direct WebDriver HTTP capture — talks to tauri-driver (port 4444)
// exactly like JustWrite's capture-direct.js. Drives the RELEASE build
// through every surface (and each design candidate while the temporary
// DesignSwitcher exists) and saves PNGs of the real WebView2 rendering.
//
// Run with: npm run screenshots   (from the app root)
//
// The app is launched with JAID_DEV_NO_SIDECAR=1 so it talks to whatever
// server is already on :8742 — start the demo server first if you want
// shots with data. Unset CAPTURE_NO_SIDECAR=0 to exercise the real
// sidecar spawn instead.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Driver } from "./lib/driver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "shots");

if (process.env.CAPTURE_NO_SIDECAR !== "0") {
  process.env.JAID_DEV_NO_SIDECAR = "1";
}

const ONCE = [
  { name: "home", hash: "#/", wait: 2200 },
  { name: "setup", hash: "#/setup", wait: 2200 },
  { name: "review", hash: "#/review", wait: 2200 },
  { name: "runs", hash: "#/runs", wait: 1800 },
  { name: "docs", hash: "#/docs", wait: 1500 },
  { name: "ai", hash: "#/ai", wait: 2500 },
  { name: "settings-appearance", hash: "#/settings/appearance", wait: 1800 },
  { name: "settings-storage", hash: "#/settings/storage", wait: 1800 },
  { name: "settings-logs", hash: "#/settings/logs", wait: 1800 },
];

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const d = new Driver();
  console.log("→ launching app via tauri-driver");
  await d.launch();
  await d.maximize();
  await d.sleep(2000);

  try {
    for (const t of ONCE) {
      console.log(`→ ${t.name} (${t.hash})`);
      await d.navigate(t.hash);
      await d.sleep(t.wait);
      const file = path.join(OUT_DIR, `${t.name}.png`);
      await d.screenshot(file);
      console.log(`   saved ${path.basename(file)}`);
    }
  } finally {
    console.log("→ ending session");
    await d.close();
  }
  console.log("done.");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
