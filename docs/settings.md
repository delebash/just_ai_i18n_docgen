# App Settings

**App Settings** in the sidebar, sections across the top:

- **Appearance** — light/dark/system theme, interface size, UI font, accent hue.
  (The title-bar moon button cycles the theme from anywhere.) Below them, **Language** — the
  interface language, each named in itself; the choice is kept and applies at once. The AI page's
  ready-made names (the Translate, Review and Confirm features, their presets, the built-in
  providers) follow it too until you rename one. English and
  Spanish ship today; another language arrives once its words are translated and reviewed.
- **Backups** — export a snapshot of this tool's own data (connections, presets,
  the reviewer name) as a ZIP, import one, or **Reset** the app to a fresh
  install. Your locale files and accepted translations are NOT in the backup —
  they live in your project folder and travel with it (git keeps those safe).
  The **Server** section's access tokens belong to this computer: a backup never
  carries them, and a restore or a reset keeps the ones this server has. While a
  restore or a reset runs, a change made in another window isn't saved — it says
  so; make it again once the app shows the restored data. A translation that is
  running is cancelled first (what it staged stays staged): the restore replaces
  the AI settings it runs on, and a reset deletes them.
- **Storage** — where app data lives (your connections, presets, the AI engine,
  downloaded models, logs) and **Change folder…**, which copies it all to the new
  folder and restarts the app. The old folder keeps its copy until you press
  **Remove the old copy** here (only what the move copied goes); **Move back to the
  default folder** while the data is elsewhere. Disk usage per category, with
  **Clear…** for the downloaded models (the model must be unloaded first) and for
  the engine's logs. Your PROJECT files are not here — they live in your app's repo
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
- **Logs** — the server's log ring: retention, day picker, download, copy. The window's own
  errors land here too, beside the server's lines (a message tells you once when one happens).
- **Updates** — the version you're on and what changed in each release.
- **Reviewer** — the name stamped on every acceptance. Set it before you review;
  an empty name records "unknown" in your committed review history.
- **About** — version and links.
