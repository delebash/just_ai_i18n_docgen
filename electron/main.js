// SPDX-License-Identifier: MIT
// The desktop app — the kit's shared Electron main module with this app's settings (the
// family's move to Electron, 2026-10-08; it replaced src-tauri/). Everything the shell does
// — the data folder, the window from app://, the tray, the dialogs, the server's life — is
// the kit's `runDesktopApp`; this file only says which app it is. No logic lives here.

import path from "node:path";
import { runDesktopApp } from "@delebash/llm-runner/shell";

const root = path.resolve(import.meta.dirname, "..");

runDesktopApp({
  id: "just-ai-i18n-docgen",
  // The data folder's name under the OS fallback (%LOCALAPPDATA%\<name>\<name>) — the same
  // name the server's data_paths ladder uses.
  appName: "just-ai-i18n-docgen",
  productName: "Just AI i18n & DocGen",
  port: 8742, // the family port registry: JW 17495 · JV 17494 · this app 8742
  serverEntry: path.join(root, "server", "src", "serve.js"),
  dataDirEnv: "JUST_AI_I18N_DOCGEN_DATA_DIR",
  repoRoot: root,
  distDir: path.join(root, "dist"),
  window: {
    title: "Just AI i18n & Docgen",
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#f7f8fa",
  },
  icon: path.join(root, "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
  trayIcon: path.join(root, "build", "tray.png"),
  logFile: path.join("logs", "just-ai-i18n-docgen.log"),
});
