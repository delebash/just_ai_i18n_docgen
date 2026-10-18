export const meta = {
  name: 'translation-findings',
  description: 'One agent rules on every string docgen or the spellchecker still flags after a translation review: fix it or accept it with a reason',
  whenToUse: 'After `node scripts/review/findings.js --dir <run>` in docgen, when it lists strings',
  phases: [{ title: 'Findings' }],
}
// SPDX-License-Identifier: MIT
// The agentic translation review, step 5 (docs/dev/agentic-review.md): one agent rules on every
// string something still flags once the decisions are applied — fix it, or accept it with a reason.
// Run after `findings.js`; args: {dir, tool, count}.
const DIR = args.dir
const CHECK = `node "${args.tool}/check.js" --dir "${DIR}"`
phase('Findings')
return await agent(
  `You are the last pass of a translation review of app catalogs. Work in the folder ${DIR}.

Read ${DIR}/guide.md and ${DIR}/terms.md (binding) first. The reviewed translation is now applied. ${DIR}/findings.md lists the ${args.count} strings that something still flags: docgen's checks (untranslated = identical to the English; endpunc; numbers), docgen's terminology advisory (a word the rest of the catalog usually renders another way — often a false alarm where a word has two senses, which the term sheet already splits, or where an inflected form hides the word), and words the spellchecker doesn't know (it lacks many valid forms and technical words). Each entry shows the English, the translation in the file, the flags, and how the string got there.

For EVERY entry, rule:
- the flag points at a real error (by guide.md's definition) → a fix;
- the string is correct → accept it, with a short reason (a name or code kept on purpose, a word the language shares with English, the term sheet's other sense, a valid word the spellchecker lacks…).
Fix errors, never restyle; a correct string is accepted.

Write two files:
- ${DIR}/out/final-fix.json — the fixes, in the reviewers' format (project, key, action "fix", value, category, severity, reason); run "${CHECK} out/final-fix.json" and clear every ERROR.
- ${DIR}/out/final-accept.json — a JSON array of {"project", "key", "reason"} for every accepted entry.
Every entry of findings.md must be in exactly one of the two files. Return the counts and up to 6 notes on what you fixed.`,
  {
    label: 'findings',
    phase: 'Findings',
    schema: {
      type: 'object',
      properties: {
        fixed: { type: 'integer' },
        accepted: { type: 'integer' },
        checkClean: { type: 'boolean' },
        notes: { type: 'array', items: { type: 'string' } },
      },
      required: ['fixed', 'accepted', 'checkClean', 'notes'],
    },
  },
)
