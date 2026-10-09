// SPDX-License-Identifier: MIT
// The desktop app — the kit's shared Electron main module with this app's settings. Everything
// the shell does — the data folder, the window from app://, the tray, the dialogs, the server's
// life — is the kit's `runDesktopApp`; this file only says which app it is. No logic lives here.
// Quasar builds this file (its Electron mode, the kit's app-structure §Q.2) and runs it in
// Electron's main process; it replaced electron/main.js with the Quasar move (2026-10-09).
import path from "node:path";
import { runDesktopApp } from "@delebash/llm-runner/shell";
import { resolveElectronAssetsPath } from "#q-app/electron/main";

const here = import.meta.dirname;
const dev = Boolean(import.meta.env.QUASAR_DEV);

runDesktopApp({
  id: "just-ai-i18n-docgen",
  // The data folder's name under the OS fallback (%LOCALAPPDATA%\<name>\<name>) — the same
  // name the server's data_paths ladder uses.
  appName: "just-ai-i18n-docgen",
  productName: "Just AI i18n & DocGen",
  port: 8742, // the family port registry: JW 17495 · JV 17494 · this app 8742 · template 17490
  // the server package (server/): its source in development, the installed copy when packaged
  serverEntry: dev
    ? path.resolve("server", "src", "serve.js")
    : path.join(here, "node_modules", "just-ai-i18n-docgen-server", "src", "serve.js"),
  dataDirEnv: "JUST_AI_I18N_DOCGEN_DATA_DIR",
  repoRoot: dev ? path.resolve(".") : null, // development: the data root is <repo>/data
  distDir: here, // Quasar puts the built renderer beside this file
  devUrl: import.meta.env.QUASAR_APP_URL,
  preload: path.join(here, "electron-preload.cjs"),
  window: {
    title: "Just AI i18n & Docgen",
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#f7f8fa",
  },
  icon: resolveElectronAssetsPath(process.platform === "win32" ? "icons/icon.ico" : "icons/icon.png"),
  trayIcon: resolveElectronAssetsPath("icons/tray.png"),
  logFile: path.join("logs", "just-ai-i18n-docgen.log"),
});
