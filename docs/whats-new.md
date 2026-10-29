# What's new

## v0.1.0

- **Errors say what went wrong, where it went wrong.** A value the server refuses is said under its
  box — Setup's path when no catalog is there, a translation or a note that is too long; when the
  server couldn't finish something, the message carries a **Reference** that finds its line in
  App Settings → Logs ([Troubleshooting](troubleshooting.md))
- **A list that couldn't load says so.** Review's list and the Runs history show the reason and
  **Retry** instead of looking empty, and Home shows it is loading instead of a blank page
  ([Troubleshooting](troubleshooting.md))
- **You can edit the AI features' prompts.** Translate, confirm and review each have one prompt in the
  AI page's Lab, saved for every run, with **Reset to default** to put the shipped one back; the Lab
  tries it on a live sample of the language you pick. A run whose prompt can't work — no `{{items}}`,
  JSON off — is refused before it starts, with the reason ([AI features](ai-features.md))
- **Gemma 4 12B is measured.** Its row in the model catalog says how it did on a 40-string
  translation test beside the 26B: no broken placeholders, plurals or glossary terms, and as few
  errors, at about half the speed on an 8 GB graphics card ([Set up the AI engine](ai-providers.md))
- **A run with no AI engine set up is refused at once**, with what to set up, instead of failing every
  string slowly ([Running a translation](translate.md))
- **Several windows on one server keep in step.** A translation saved, accepted or applied, or a run
  started, in one window shows in the others by itself — the desktop app, a browser on this server,
  a phone. How often they look is in App Settings → General ([App Settings](settings.md))
- **The family's page look.** Cards, hints, the sidebar and the start screen take the shared design
  every family app has; an address with no page shows a page that says so, inside the app
- **The server turns away other web pages' reads.** A page open in your browser can no longer read
  docgen's server behind your back (a backup, your keys); the app's own windows are unaffected. A
  reverse proxy's name goes in `JUST_AI_I18N_DOCGEN_ALLOWED_HOSTS` ([App Settings](settings.md))
- **Access tokens are checked as you add them.** A pasted token's surrounding spaces are dropped, and
  one with spaces or accents inside is refused with the reason ([App Settings](settings.md))
- **A changed English string is found.** When an English string changes after it was translated,
  Review flags it `source-changed` with the old English beside it, and a pending run translates it
  again ([Review](review.md))
- **The command line never writes over what you reviewed.** `translate` keeps every translation
  whose English hasn't changed — changing the project's context sentence or glossary no longer
  re-translates the whole catalogue ([The command line](cli.md))
- **The command line on macOS and Linux.** The installed app carries `just-ai-i18n-docgen` there too,
  and on every system it trusts the system's certificates ([The command line](cli.md))
- **Runs shows a running run as Home does** — the same strip, with its Cancel ([Running a
  translation](translate.md))
- **Server and About in App Settings are the family's.** Server copies the address, generates an
  access token and copies the address with a token for a browser on another computer; About shows
  the desktop runtime and the data folder beside the version ([App Settings](settings.md))
- **Change folder keeps the old copy until you remove it.** Settings → Storage shows the copy a
  move left behind, with its size and **Remove the old copy**, and a **Move back to the default
  folder** while the data is elsewhere ([App Settings](settings.md))
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
