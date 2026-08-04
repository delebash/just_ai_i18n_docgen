# Settings

**App Settings** in the sidebar, sections across the top:

- **Appearance** — light/dark/system theme, interface size, UI font, accent hue.
  (The title-bar moon button cycles the theme from anywhere.)
- **Storage** — where app data lives (the AI engine, downloaded models, logs) and
  a **Relocate** that moves it and restarts the app. Disk usage per category with
  **Clear models cache** (the model must be unloaded first) and **Clear engine
  spawn logs**. Your PROJECT files are not here — they live in your app's repo
  (see [Your files](files-and-git.md)).
- **Server** — for headless use: the URL to open in a browser, bearer tokens
  (auth is off while the token list is empty), and "require for loopback" if
  even local requests must authenticate.
- **Logs** — the server's log ring: retention, day picker, download, copy.
- **Reviewer** — the name stamped on every acceptance. Set it before you review;
  an empty name records "unknown" in your committed review history.
- **About** — version and links.
