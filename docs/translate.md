# Running a translation

Home is the language dashboard: one row per target language with a progress bar,
a status chip, and the last run time. Click a row to open it in
[Review](review.md).

## Start a run

Tick the languages you want and press **Translate**. Languages run one after
another, each as a job with scope **pending** — every key that is *missing* in
that language plus every key the checks *flagged*. The run strip shows live
progress; the AI-tasks button in the title bar hosts the same view from anywhere.

Rules a run always follows:

- **One job at a time.** Starting a second is refused, not queued.
- **Cancel keeps staged work.** Everything already translated stays staged for
  review; nothing is thrown away.
- **Exhausted keys are NAMED.** If a key fails every retry (the engine kept
  breaking a placeholder, say), the run finishes with that key listed — never
  silently skipped.

The **Runs** page offers the same start controls plus scope choices
(`pending` / `flagged` / `unsure` / `all`) and the full run history. One honest
note: `unsure` selects keys the [probe](verification.md) marked as disagreements —
and today the probe only runs from the CLI, so on an app-only workflow that scope
finds nothing.

## The staged pile — read this once

A run **writes no locale files**. It stages proposals. So after your very first
run the language row may say `0 done` *and* `120 staged` — that is a **successful
run waiting for you**, not a failure. Open Review, look at the pile, and press
**Apply all** when you're ready: *that* click is the first time anything touches
`<lang>.json`.
