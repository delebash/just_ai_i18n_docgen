export const meta = {
  name: 'translation-verify',
  description: 'Adversarial verifiers over a translation review\'s decisions (the MQM-APE filter)',
  whenToUse: 'After `node scripts/review/merge.js --dir <run> reviews` in docgen',
  phases: [{ title: 'Verify', detail: 'each decision stands only if it is the best option; overturned ones are rewritten and self-checked' }],
}
// SPDX-License-Identifier: MIT
// The agentic translation review, step 3 (docs/dev/agentic-review.md): the MQM-APE filter — each
// verifier tries to overturn the reviewers' decisions in its verify-N.md. Run after
// `merge.js reviews`; args: {dir, tool, verifiers: 2}.

const DIR = args.dir
const CHECK = `node "${args.tool}/check.js" --dir "${DIR}"`
const N = args.verifiers ?? 2
const SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    checked: { type: 'integer', description: 'entries in your verify file that you judged' },
    agreed: { type: 'integer' },
    toA: { type: 'integer' },
    toB: { type: 'integer' },
    newFix: { type: 'integer' },
    checkClean: { type: 'boolean', description: 'the check on every file you wrote reported no ERROR lines' },
    notes: { type: 'array', items: { type: 'string' }, description: 'at most 8 short notes: patterns in what you overturned' },
  },
  required: ['files', 'checked', 'agreed', 'toA', 'toB', 'newFix', 'checkClean', 'notes'],
}

phase('Verify')
return await parallel(
  Array.from({ length: N }, (_, i) => i + 1).map((v) => () =>
    agent(
      `You are verifier ${v} of ${N} in a translation review of app catalogs. Work in the folder ${DIR}.

Read ${DIR}/guide.md (the rules and what counts as an error) and ${DIR}/terms.md (the binding term sheet) first.

Your input is ${DIR}/verify-${v}.md: decisions made by the reviewers. Each entry has the item's English, its candidates (A = docgen's proposal, B = the translation in the file now), the reviewer's decision (A, B, or a fix with its new text) with category, severity and reason, and the check's verdict on the reviewer's text. The heading gives the item's batch and number; ${DIR}/batch-<batch>.md shows its neighbours if you need the screen's context.

Your job is the MQM-APE filter, done adversarially: a decision stands only if it is really the best option. For each entry, try to show it is wrong:
- a fix that corrects no real error, or that makes the string worse (wrong meaning, unnatural language, breaks the term sheet, a placeholder, the plural forms, or agreement) → overturn it to the better candidate, A or B;
- a real error with a flawed or incomplete fix → overturn it with your own fix;
- a CHOOSE pick (A or B) where the other candidate is clearly better → overturn it;
- a NO CANDIDATE translation → check it as thoroughly as a fix.
Do not overturn a correct decision for taste: if the decision is correct, it stands. Fix errors, never restyle.

Write entries ONLY for decisions you overturn, in the reviewers' format (guide.md, "What you write"): n = the item number from the heading ("batch b item n"), project, key, action ("A", "B" or "fix"), value for a fix, category, severity, and a reason that starts "Overturned: " and says what was wrong with the reviewer's decision. Work through the file in chunks of about 150 entries (the Read tool's offset and limit); after each chunk write ${DIR}/out/verify-${v}-<k>.json (k = 1, 2, …; a JSON array, possibly empty) and run:
  ${CHECK} out/verify-${v}-<k>.json
Fix every ERROR line; answer every WARN in the reason.

Return the files, the counts (entries checked, agreed, overturned to A, to B, new fixes), whether the checks ended clean, and at most 8 notes on what you overturned.`,
      { label: `verify ${v}`, phase: 'Verify', schema: SCHEMA },
    ),
  ),
)
