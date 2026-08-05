# The verification passes

Translation quality isn't asserted here — it's checked, four different ways.
Findings from every pass land in the same [Review](review.md) queue.

## 1 · The checks — offline, deterministic, free

Every written string is checked the moment it's written (and again every time you
save an edit): placeholders intact, plural halves present and distinct, glossary
respected, punctuation edges, numbers, brackets, doubled words, whitespace. No
engine, no network, no randomness — the same input always flags the same way.
`check` on the [command line](cli.md) runs exactly these and exits non-zero on
failures, so it works as a CI gate.

## 2 · The probe — does the engine agree with itself?

A probe re-translates a sample of keys with the same engine and compares. Keys
where the two passes *disagree* get the advisory `disagreement` flag and rank the
key as worth human eyes. Two honesty rules: the probe **refuses to run at
temperature 0** (two identical passes prove nothing), and "every key agreed" is
reported as a *warning*, not a clean bill — agreement is weak evidence, not proof.
*Today the probe runs from the CLI (`translate --probe`); a run started from the
app doesn't probe.*

## 3 · The confirmation pass — pre-ticking the obvious

Some strings are legitimately identical in two languages ("OK"). The confirmation
pass asks the engine, string by string, ONLY about targets byte-identical to
their source: "is this genuinely the same in this language?" Confirmed ones
arrive in Review **pre-ticked** for one-click bulk accept. It never writes an
acceptance itself — measured ~7.5% false-clear on short strings is exactly why
the final click stays yours. It runs after CLI `translate` runs AND after
app-started runs (since 2026-08-04): a finished run's byte-identical proposals
get the second opinion while the job shows "confirming", and Cancel still works
between keys.

## 4 · Terminology — consistency with yourself

Your own catalogue is mined for dominant term translations; a key that renders a
term differently from the rest of your app gets the advisory `terminology` flag.

## Escalation — a bigger engine for the stubborn keys

When the everyday model keeps failing specific keys, **escalate**: re-translate
only the flagged keys with a stronger preset (a bigger local model, or an online
provider). Everything the cheap engine got right stays untouched. Today this is
CLI-only: `escalate <config> <preset-id>` — create the stronger preset on the AI
Settings page first.
