# Troubleshooting

**"Can't reach the server" screen.** The Python server isn't running (dev:
`npm run server`) or the port is taken. The app deliberately refuses to render
without it — there is no offline mode to silently lose work in.

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
