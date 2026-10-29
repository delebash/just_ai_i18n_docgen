# The AI features

Three features run on the AI engine. Each is a row under **AI Settings →
Routing by feature**, each with its own engine preset — one model can serve
all three, or any one can point at a stronger model.

## Translate

The batch translate loop — the tool's core. Pending keys go out in batches:
each string is **shielded** first (placeholders, glossary terms and markup are
swapped for tokens the model cannot break), sent with your per-language
conventions and reviewer notes, then restored and checked on the way back. A
string whose shield comes back damaged is refused, never written.

## Review

The back-translation pass: the translated string is translated *back* toward
the source and shown beside it, so a reviewer who doesn't read the target
language can spot drift. Shown to the reviewer only — never written to a
catalogue. Review deliberately routes to the **same engine the translation
used**; a second opinion from the same model about its own work is the point
(what changed in back-translation is signal, not judgment).

## Confirm

The second opinion on byte-identical targets — strings whose translation came
back identical to the source. One key per call, by design. It annotates
("plausibly identical in this language" vs "looks untranslated"); it never
signs off a string by itself.

## What is deliberately not here

**Extract** (docs front-matter → locale keys) has no routing row: it is pure
parsing with no engine call anywhere, and a routing row for a feature that
cannot route would lie. It re-appears the day it gains a real AI step.

## Each feature's prompt

Each feature has one prompt, and you can read and change it in the AI page's
Lab (**Routing by feature** → the feature): its instructions, its message, and
its JSON answer. The parts in `{{double braces}}` are filled from your project
on every run — the languages, the context sentence and the glossary from Setup,
the per-key notes from Review, and the strings themselves, with placeholders and
glossary terms already swapped for `⟦0⟧`-style tokens. A rule that doesn't apply
to your project (no glossary, no plural separator) is left out whole.
**Reset to default** puts the shipped prompt back.

A run checks its prompt before it starts. A prompt without `{{items}}` (where
the strings go), with **Output as JSON** off, or using a `{{name}}` the run
doesn't fill is refused, with the reason and the fix; the confirmation pass
checks its own prompt when it starts. See
[Set up the AI engine](ai-providers.md) for trying a prompt in the Lab.
