# What's new

## v0.1.0

- **Notices read properly.** A notice with a long button puts the button under its text instead of
  squeezing the text into a narrow column, and the "Your graphics hardware changed" notice on the
  AI page shows its title ([AI engine](ai-providers.md))
- **The AI page's ready-made names in your language.** With Spanish chosen, the Translate, Review
  and Confirm features, their presets and the built-in providers show in Spanish — until you
  rename one, which then stays as you wrote it ([Settings](settings.md))
- **Language names follow the interface.** With Spanish chosen, Home, Review and Runs name each
  language in Spanish ("Español (es)") instead of the window's language ([Settings](settings.md))
- **Fewer false flags on plurals.** A translation that adds plural forms its source doesn't need
  is checked form by form, and a string that is empty in the source on purpose counts as done
  instead of ending a run as exhausted ([Review](review.md))
- **docgen in Spanish.** Choose **Español** in Settings → Appearance → Language and every screen
  is in Spanish, the shared AI and settings screens included ([Settings](settings.md))
- **Settings → Appearance has a Language picker.** Every word on docgen's own screens now comes
  from its catalog (`src/i18n/locales/en.json`), so the interface can follow the language you
  pick once its words are translated — today English and Spanish
  ([Settings](settings.md))
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
