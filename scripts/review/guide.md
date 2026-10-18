# The translation review — the guide every agent follows

You review the translation of app catalogs, in the MQM way: find real errors, give each a category
and a severity, and fix it. The people who ship these strings may not read the language and won't
check your work — what you sign off ships. Be exact, and be conservative: **fix errors, never
restyle**.

Keys that sit next to each other in a batch are usually on the same screen: read neighbours for
context. The last part of a key often says what the string is (`.title`, `.label`, `.tooltip`,
`.desc`, `.placeholder`, `.button`, `.confirm`, `.error`, `.empty`, `nav.*`).

The language's own rules follow at the end of this guide, after the catalogs in this run. **The
term sheet** (`terms.md`, beside this guide) is binding: where it names a term, use it. A string that
uses another word for a term the sheet fixes is a terminology error.

## Never translate

Each project's glossary (its docgen config's `doNotTranslate`) stays as written, and so do other
product, brand and format names, proper names, model names, file names and extensions, code,
commands, URLs, environment variables, units (MB, GB, tok/s) and keyboard keys (Ctrl, Shift, Enter,
Esc).

## vue-i18n's format — breaking it breaks the app

- `{name}` is a placeholder: keep every one exactly, with the same name, never translated.
- `|` separates plural forms. Keep **the same forms, in the same order**, as the English
  (`no notes | {n} note | {n} notes` → three forms). A string the English has as one form with a
  `{n}` or `{count}` may take two forms where the language needs them ("{n} encontrado | {n}
  encontrados") — vue-i18n picks the form from `n`.
- `@` starts a linked message. A literal @ must be written `{'@'}` exactly where the English has
  it; never add a bare `@`, `{`, `}` or `|` the English doesn't have.
- Keep `\n`, Markdown and HTML tags, leading and trailing spaces as in the English.

## What counts as an error

| Category | Examples |
|---|---|
| accuracy | wrong meaning; the wrong sense of a word for this screen; something left out or added; English left untranslated (except the names above and the language's own exceptions) |
| fluency | a non-word; wrong agreement, gender, article or verb form; unnatural word-for-word phrasing a native speaker wouldn't write |
| terminology | a term the sheet fixes, rendered another way; the same concept named differently from its neighbours |
| locale | the wrong register or variety for the language's rules; wrong punctuation or capitalisation conventions |
| format | a placeholder, plural form, linked-message or tag rule above broken |

Severity: **critical** — breaks the app or says the opposite; **major** — wrong meaning or language a
user would notice is wrong; **minor** — understandable but awkward, or a small inconsistency.

**Not errors — leave them alone:** a correct string you would have worded differently; a correct
synonym the term sheet doesn't fix; length, unless a button, tab, chip or menu label is much longer
than the English and an equally correct shorter wording exists. When in doubt, keep.

## The batch file

Each item has the English (`EN`), then:
- **A** — docgen's proposal (made by a model, with the project's context sentence);
- **B** — the translation in the file now, shown only when it differs from A;
- marks: **CHOOSE A or B (or fix)**, or **NO CANDIDATE: write the translation**;
- `docgen checks on A/B` and `spellchecker doesn't know` — hints, not verdicts. The spellchecker
  doesn't know many technical words and inflected forms; docgen's checks are usually right.

## What you write

A JSON array of entries. **List an item when:** it is marked CHOOSE (always — A, B or a fix), it is
marked NO CANDIDATE (always — a fix), or you change it (a fix, or B where B is the better one).
Correct items that need no choice are not listed: A is applied for them.

```json
{"n": 412, "project": "jw", "key": "chapters.ai.twistsDesc", "action": "fix",
 "value": "Giros y reveses que …", "category": "fluency", "severity": "major",
 "reason": "\"reviravones\" is not a word"}
```

- `n`, `project`, `key` — copied from the item's heading.
- `action` — `"A"`, `"B"` or `"fix"`; only a fix carries `value` (the whole new string).
- `category` and `severity` — for a fix, or when you choose the candidate because the other has an
  error; omit both when A and B are equally correct.
- `reason` — one short English sentence. If the string you write still trips a docgen check on
  purpose (a word the language shares with English, a number written out), say so here.

Check every file you write with the command your instructions give
(`node <tool>/check.js --dir <run> <file>`): it checks every entry's shape and runs docgen's
checks, vue-i18n's message compiler and the spellchecker on the text your entry would write. ERROR
lines must be fixed; WARN lines need a reason in the entry; HINT lines are for you to judge.
