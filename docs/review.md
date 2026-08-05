# Reviewing — flags, accepting, notes

Open **Review**. The language picker shows outstanding counts and lands you on
the *busiest* language — where the work actually is.

## The workspace

Three panes. On the left, the **queue rail**: buckets with live counts — *Needs
review* (anything a hard check flagged), *Unsure*, *Terminology*, *Missing*,
*Came back identical*, *Proposed*, *All flagged* — plus **Accepted** (every
verdict you've recorded, with an **Un-accept** on each: a decision can always be
revisited). Under the buckets, a **per-check breakdown** — ten spurious
questions are ten instances of the same decision, so working one code at a time
beats context-switching — and a **search** box over keys and text.

In the middle, the **list**: one terse row per key. Its job is only to let you
move; judging happens in the detail pane. A reviewed key shows struck-through.
In the *Came back identical* bucket the list grows a bulk bar: tick rows (or
press "tick the N the engine calls correct" — a suggested selection, nothing
more) and **Approve** them in one click, one undo.

On the right, the **detail pane** — everything a reviewer once left the page to
find out: why it's flagged in plain English, the source with placeholders
marked, the engine's proposal, a **Google Translate second opinion** (an
independent reading — neither source is reliably better; copy it across only if
you agree), a **back-translation**, the namespace siblings, and the note box.

## The keyboard

`j`/`k` (or arrows) move · `a` accept · `u` undo · `e` edit the target ·
`g` toggle the Google panel · `b` back-translate · `/` search ·
`Ctrl/⌘Z` undo · `Escape` leaves a text box. Keys never fire while you type.

## The staged pile

If the last run staged translations, a banner offers **Apply all** (with a
confirmation naming the file it writes) and **Discard them**. Applying writes
`<lang>.json` and immediately re-runs the checks on what was written — whatever
they flag lands in the queue below.

## What the flags mean

Each queued key shows its source, an editable target, and one or more flags:

- `missing` / `blank` — no translation, or an empty one.
- `placeholder-changed` — a `{name}`-style token was lost or altered. The #1
  ship-blocker; the app would crash or print garbage.
- `plural-halves-lost` / `plural-halves-identical` — a `one|other` plural lost a
  half, or both halves came back identical.
- `glossary-translated` — a do-not-translate term got translated.
- `untranslated` — the target equals the source (often correct — "OK" is "OK" in
  Spanish; that's what accepting is for).
- `startpunc` / `endpunc` / `spurious-interrogative` — punctuation drift at the
  edges (¿…? handling in Spanish, trailing colons, …).
- `numbers` / `brackets` / `doublewords` / `whitespace` — numbers changed,
  brackets unbalanced, a word doubled, or stray whitespace.
- `disagreement` — *advisory*: a second engine pass translated this key
  differently; worth a look, never a failure.
- `terminology` — *advisory*: this key translates a term inconsistently with the
  rest of your catalogue.

## The actions

- **Save** — edit the target and save; the checks re-run instantly and the row
  re-flags or clears on the spot.
- **Accept as correct** — "I looked; this is right." The flag stops appearing.
- **Unaccept** — take it back.
- **Apply proposal** — take the engine's staged suggestion for this one key.
- **What does it say?** — a back-translation of the current target into your
  language, from the same engine that translated it. A sanity mirror, not proof.
- **Note for the next run** — see below.
- **Siblings** — nearby keys (same prefix), for consistency checks.
- **Undo** — one click undoes the last action, even when that action was a bulk
  apply of two thousand keys.
- **Accept N pre-ticked** — bulk-accepts rows whose only flag is `untranslated`
  and which the confirmation pass verified as genuinely-the-same. The pass runs
  after CLI `translate` runs AND after app-started runs (since 2026-08-04): when
  a run finishes, its byte-identical proposals get the second opinion, and the
  rows arrive pre-ticked the moment you apply them. The engine still never signs
  off — pre-ticks are annotations; the acceptance is always your click.

## Accepting — why acceptances expire

An acceptance is a statement about **one exact pair of strings**: it's recorded
against the key, the flag code, the source text, and the target text. Edit either
side — even one character — and the finding comes back for fresh eyes. That's
deliberate: "I approved this sentence" must never silently cover a different
sentence.

Acceptances live in `<lang>.accepted.json`, committed to git, each stamped with
the **reviewer name** from Settings → Reviewer. Set that name — otherwise your
review record says "unknown" forever.

## Notes — teaching the next run

A note rides with its key into the next translation prompt. The canonical
example: the engine translated a button labeled "Why?" literally, when the app
wanted the interrobang tone of "¿Por qué?" — a one-line note fixed it on the next
run and every run after. Notes live in `<lang>.notes.json`, committed.
