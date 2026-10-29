# What's new

## v0.1.0

- **A run's card survives a reload.** The Runs page shows the last run after a reload or
  a restart — how it ended, why it failed, and the keys it couldn't deliver — and a window
  opened mid-run picks the run up with its progress and Cancel ([Running a translation](translate.md))
- **A restore or a reset stops a running translation first.** What it staged stays staged; the
  run no longer carries on under AI settings that were just replaced ([App Settings](settings.md))
- **Every font in the Appearance picker shows.** The fonts ship with the app, so choosing one
  changes the interface's type — offline too ([App Settings](settings.md))
- **"Can't reach the server" says why.** When another program or another person's copy of the
  app holds port 8742, Windows has reserved it, or the server stopped as it started, the screen
  says so and what to do ([Troubleshooting](troubleshooting.md))
- **The window's own errors reach the log.** A failure in the window lands in App Settings →
  Logs beside the server's lines ([App Settings](settings.md))
- **Backups keep the access tokens out.** A backup no longer carries the Server section's access
  tokens, and a restore or a reset keeps the ones this computer has; a change made in another
  window while a restore runs is refused instead of lost ([App Settings](settings.md))
- **The desktop app's menus in your language.** With Spanish chosen, the tray icon's menu and the
  right-click menu (cut, copy, paste, spelling suggestions) are in Spanish too ([App Settings](settings.md))
- **Notices read properly.** A notice with a long button puts the button under its text instead of
  squeezing the text into a narrow column, and the "Your graphics hardware changed" notice on the
  AI page shows its title ([AI engine](ai-providers.md))
- **The AI page's ready-made names in your language.** With Spanish chosen, the Translate, Review
  and Confirm features, their presets and the built-in providers show in Spanish — until you
  rename one, which then stays as you wrote it ([App Settings](settings.md))
- **Language names follow the interface.** With Spanish chosen, Home, Review and Runs name each
  language in Spanish ("Español (es)") instead of the window's language ([App Settings](settings.md))
- **Fewer false flags on plurals.** A translation that adds plural forms its source doesn't need
  is checked form by form, and a string that is empty in the source on purpose counts as done
  instead of ending a run as exhausted ([Review](review.md))
- **docgen in Spanish.** Choose **Español** in Settings → Appearance → Language and every screen
  is in Spanish, the shared AI and settings screens included ([App Settings](settings.md))
- **Settings → Appearance has a Language picker.** Every word on docgen's own screens now comes
  from its catalog (`src/i18n/locales/en.json`), so the interface can follow the language you
  pick once its words are translated — today English and Spanish
  ([App Settings](settings.md))
- The engine's Update button works again (it had stopped appearing when llama.cpp
  changed how it labels releases). It offers llama.cpp's newest official release or the
  build the app is tested with, whichever is newer, and an update can no longer leave you
  unable to load models — a new engine is checked before it replaces the one you have
  ([AI engine](ai-providers.md))
- Translate standard i18n JSON locale folders with a local or online AI engine
- Every written string verified — structure, placeholders, and a confirmation pass
- The review workspace: nothing ships unseen; acceptances are recorded per string
- Help-doc authoring whose front matter becomes locale keys
- One CLI with the same checks as the app (translate · check · escalate · accept · extract)
- The family AI stack: Quick Setup, measured translation models, routing by feature
- Backup / restore from Settings → Backups
