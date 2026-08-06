# Settings

**App Settings** in the sidebar, sections across the top:

- **Appearance** — light/dark/system theme, interface size, UI font, accent hue.
  (The title-bar moon button cycles the theme from anywhere.)
- **Backups** — export a snapshot of this tool's own data (connections, presets,
  the reviewer name) as a ZIP, import one, or **Reset** the app to a fresh
  install. Your locale files and accepted translations are NOT in the backup —
  they live in your project folder and travel with it (git keeps those safe).
- **Storage** — where app data lives (the AI engine, downloaded models, logs) and
  a **Relocate** that moves it and restarts the app. Disk usage per category with
  **Clear models cache** (the model must be unloaded first) and **Clear engine
  spawn logs**. Your PROJECT files are not here — they live in your app's repo
  (see [Your files](files-and-git.md)).
- **Server** — for headless use: the URL to open in a browser, bearer tokens
  (auth is off while the token list is empty), and "require for loopback" if
  even local requests must authenticate. **Keep server running after the app
  closes**: with it on, closing the window hides the app to the system tray and
  the server keeps serving — left-click the tray icon to bring the window back.
  The tray menu carries 📺 Show / 🔵 Hide window, ▶️ Start / ⏹ Stop / 🔄 Restart
  server, ⚙️ Open settings, 📋 Copy server URL (copies and confirms),
  📜 Open log file, ℹ️ About, and 🚪 Quit — which stops the server too. With
  the switch off, closing the window stops everything.
- **Logs** — the server's log ring: retention, day picker, download, copy.
- **Updates** — the version you're on and what changed in each release.
- **Reviewer** — the name stamped on every acceptance. Set it before you review;
  an empty name records "unknown" in your committed review history.
- **About** — version and links.
