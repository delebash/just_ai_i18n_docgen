export const meta = {
  name: 'translation-review',
  description: 'A term sheet, then one MQM reviewer per batch over a translation exported by docgen\'s review tool',
  whenToUse: 'After `node scripts/review/export.js` in docgen: reviews the exported translation, one agent per batch',
  phases: [
    { title: 'Terms', detail: 'one agent builds or extends the term sheet from the catalogs' },
    { title: 'Review', detail: 'one agent per batch: choose, fix, translate; self-checked with check.js' },
  ],
}
// SPDX-License-Identifier: MIT
// The agentic translation review, step 2 (docs/dev/agentic-review.md): the term sheet, then one MQM
// reviewer per batch. Run after export.js; args: {dir, tool, batches: [1, 2, …], terms: true}.
//   dir    — the run folder (absolute)
//   tool   — docgen's scripts/review folder (absolute), for the check command
//   terms  — false skips the term-sheet agent (a small run of new strings keeps the sheet it has)

const DIR = args.dir
const TOOL = args.tool
const CHECK = `node "${TOOL}/check.js" --dir "${DIR}"`

const TERMS_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    entries: { type: 'integer' },
    decisions: {
      type: 'array',
      description: 'up to 25 of the most consequential decisions: terms whose rendering was split or wrong',
      items: {
        type: 'object',
        properties: { en: { type: 'string' }, tr: { type: 'string' }, was: { type: 'string' } },
        required: ['en', 'tr', 'was'],
      },
    },
  },
  required: ['file', 'entries', 'decisions'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    entries: { type: 'integer' },
    fixes: { type: 'integer' },
    chooseA: { type: 'integer' },
    chooseB: { type: 'integer' },
    translated: { type: 'integer' },
    coverageClean: { type: 'boolean', description: 'the --coverage check reported every item listed' },
    checkClean: { type: 'boolean', description: 'the check on every file reported no ERROR lines' },
    notes: { type: 'array', items: { type: 'string' }, description: 'at most 8 short notes on patterns seen across many strings' },
  },
  required: ['files', 'entries', 'fixes', 'chooseA', 'chooseB', 'translated', 'coverageClean', 'checkClean', 'notes'],
}

let terms = null
if (args.terms !== false) {
  phase('Terms')
  terms = await agent(
    `You build the term sheet for a translation review of app catalogs. Work in the folder ${DIR}.

Read ${DIR}/guide.md first: what the catalogs are (each project's own context sentence) and the language's rules, including any rules the family has fixed for this language.

Your input is ${DIR}/terms-input.md: every English word or two-word term that appears in 3+ strings, with the words that most often appear in those strings' translations now (docgen's proposal, or the file's translation where there is none). Lines marked SPLIT render the term in more than one way. ${DIR}/data.json holds every item (project, key, en, cands.A, cands.B); grep it (or the batch-*.md files) whenever you need to see a term in its real strings before deciding. Look at real strings for every term you decide — a co-occurrence count is not a translation.

If ${DIR}/terms.md exists, it is the family's term sheet so far: EXTEND it — keep every row unless the catalogs show it wrong (say so in "was"), and add rows for the recurring terms it lacks. If it doesn't exist, write it, under 250 lines, in this shape:
1. "## Style" — a few binding decisions, each checked against what the catalogs already mostly do: the form of button and menu labels, the form of instructions and descriptions, how errors and empty states read, sentence case.
2. "## Terms" — a table: English | translation | note. Cover: the language's fixed rules; every recurring term of the products' own vocabulary; every SPLIT term where the split is an inconsistency rather than two senses of one word; terms that stay in English. Where one English word has two senses, give both rows.

Decide each term by: (1) correct for this app's meaning, (2) what the catalogs already mostly use, so fewer strings change, (3) the variety the language's rules name. Be decisive: one term per sense.

Return the file path, the number of table rows, and up to 25 of the most consequential decisions (en, the translation you chose, and what the catalogs did before).`,
    { label: 'term sheet', phase: 'Terms', schema: TERMS_SCHEMA },
  )
  log(`term sheet: ${terms ? terms.entries : 0} rows`)
}

phase('Review')
const n = args.batches.length
const reviews = await parallel(
  args.batches.map((b) => () =>
    agent(
      `You are reviewer ${b} of ${n} in a translation review of app catalogs. Work in the folder ${DIR}.

Read ${DIR}/guide.md (the rules, what counts as an error, what to write) and ${DIR}/terms.md (the binding term sheet) first. Then review EVERY item of ${DIR}/batch-${b}.md. Read it in chunks of about 150 items (the Read tool's offset and limit) and give every item real attention: nobody will read these strings after you, so an error you miss ships. Use the neighbouring keys for context.

After each chunk, write that chunk's entries to ${DIR}/out/review-${b}-<k>.json (k = 1, 2, 3, … one file per chunk; a JSON array, possibly empty) and run:
  ${CHECK} out/review-${b}-<k>.json
Fix every ERROR line and rewrite the file; answer every WARN in the entry's reason; judge every HINT.

When the whole batch is done, run:
  ${CHECK} --coverage ${b}
It must say every CHOOSE and NO CANDIDATE item is listed; if not, add the missing ones (to a new part file) and re-run both checks.

Return the files you wrote, the counts, whether both checks ended clean, and at most 8 short notes on patterns you saw across many strings (for example a term the proposals get wrong again and again).`,
      { label: `review ${b}`, phase: 'Review', schema: REVIEW_SCHEMA },
    ),
  ),
)
return { terms, reviews }
