# Troubleshooting

**"Can't reach the server" screen.** The app's server isn't running, or its port (8742)
is taken — the screen says which when it knows:

- **Another program is using port 8742** — close that program, then press **Retry**.
- **Another person signed in to this computer has the app open** — one copy runs at a time on a
  computer: they quit theirs (its tray icon, **Quit**), then press **Retry**.
- **Windows has reserved port 8742** (Hyper-V, WSL or Docker reserve ranges of ports at start) —
  restarting the computer usually frees it. `netsh int ipv4 show excludedportrange protocol=tcp`
  lists the reserved ranges. To keep the port free for the app, open a Command Prompt as
  administrator and run `net stop winnat`, then
  `netsh int ipv4 add excludedportrange protocol=tcp startport=8742 numberofports=1 store=persistent`,
  then `net start winnat`, and restart the computer.
- **Its server stopped as it started** — the words after it say why; **Open log file** in the tray
  shows the rest.

The desktop app starts the server itself; the tray menu's **Restart server** starts it again,
and **Open log file** shows why it stopped. Headless, start it with
`just-ai-i18n-docgen-server serve` (`npm run server` from a source checkout). The app
deliberately refuses to render without it — there is no offline mode to silently lose work in.

**Another copy is already running.** One server per data folder: a second one says that
another Just AI i18n & DocGen server is using this data folder. Quit the other copy (the
tray's **Quit**), or give the second one its own `--data-dir`.

**A message showed an error from the window.** The window's own errors land in
**App Settings → Logs** beside the server's lines, so the details are there.

**Home shows the welcome screen although I set up before.** The welcome only
appears on a confirmed "no project loaded" answer from the server. If your
config moved or the path in it broke, open Setup and re-check the path.

**"Engine not configured" when translating.** No default AI provider yet — run
Quick Setup on the AI Settings page, or add an online provider and set it as
default.

**A run finished but `done` is 0.** That's the [staged pile](translate.md) — the
run stages proposals; open Review and press Apply all. Nothing was lost.

**Keys listed as "exhausted" at the end of a run.** The engine failed those keys
on every retry (usually a placeholder it kept breaking). They're named so you can
fix them by hand in Review, add a [note](review.md) to steer the next run, or
[escalate](verification.md) them to a stronger preset.

**The probe refuses to run.** Probing needs a non-zero temperature — at
temperature 0 the second pass is a copy of the first and proves nothing. Raise
the preset's temperature on the AI Settings page or skip the probe.

**Empty content from a thinking model.** Some models spend the whole token
budget "thinking" and return nothing. The error says so; raise max tokens on the
preset or turn thinking off.

**`check` fails in CI but the app looks clean.** CI checks the files as
committed — commit your applied translations and `<lang>.accepted.json`
together. Advisory flags (`disagreement`, `terminology`) never fail `check`.

**Back-translate shows an error.** "What does it say?" needs the engine; when
the engine is down it fails soft (a 502) and never blocks reviewing or saving.
