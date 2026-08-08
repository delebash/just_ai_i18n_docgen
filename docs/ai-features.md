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

## Prompts are built, not stored

This tool builds each feature's prompt from your project data on every run —
context and glossary, per-key notes, the shielded strings. The Routing-by-
feature Lab shows the *real* generated prompt for `translate` and `confirm`;
to change what it says, edit the data it is built from (see
[Set up the AI engine](ai-providers.md) for the Lab's mechanics).
