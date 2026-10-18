# The agentic translation review — how to run it

Claude Code agents review a language's translations of one or more docgen projects, in the MQM
way, and docgen's own routes apply the result: nothing ships without passing docgen's checks and
vue-i18n's message compiler, every write is undoable in docgen, and acceptances are recorded under a
named reviewer. Built for the family's Spanish (2026-10-17: 4,840 strings, three catalogs; the
numbers and the method's sources are in RESEARCH, "Automatic translation review: tools"); saved here
2026-10-18 so any run — a whole catalog, or only its new strings — is the same few commands.

**NOT STANDARD** (no maintained tool runs the whole loop — RESEARCH); decided by the user
2026-10-18 ("your rec on all go … take your own rec go on all", JustWrite's TASKS "Automated
testing").

## What's where

| Path | What |
|---|---|
| `scripts/review/*.js` | the steps (below); `run.js` the shared parts |
| `scripts/review/guide.md` | the method every agent follows, language-neutral |
| `scripts/review/lang/<code>.md` | the language's rules (variety, register, the family's fixed rules) — `es.md` |
| `scripts/review/terms/<code>.md` | the family's term sheet for the language, binding; a run extends it |
| `.claude/workflows/translation-*.js` | the agent steps, as saved Claude Code workflows |

A run folder (any empty folder — keep it outside the repos) holds what one run writes.

## A whole review

```bash
# 1. Export (reads only): the projects, ~800 strings per batch
node scripts/review/export.js --dir <run> --lang es \
  --project jw=../justwrite-app/just-ai-i18n-docgen/config.json \
  --project kit=../just-core/packages/ui/just-ai-i18n-docgen/config.json \
  --project docgen=just-ai-i18n-docgen/config.json
```

2. **Review** — in Claude Code: the `translation-review` workflow with
   `{dir: "<run>", tool: "<docgen>/scripts/review", batches: [1, …, N]}` (N = the batches export
   printed). One agent extends the term sheet, then one reviewer per batch writes `out/review-*.json`,
   each file checked as it goes.
3. `node scripts/review/merge.js --dir <run> reviews` — one decision per item, and the verifiers'
   input (`verify-1.md`, `verify-2.md`). It exits 1 on a malformed entry or a required item no one
   listed; fix those first.
4. **Verify** — the `translation-verify` workflow with `{dir, tool, verifiers: 2}`: each decision
   stands only if a refuting verifier can't overturn it (the MQM-APE filter).
5. `node scripts/review/merge.js --dir <run> final`, then for each project
   `node scripts/review/apply.js --dir <run> <project> --dry-run` and without `--dry-run`. Apply
   runs docgen's server on a scratch data folder in the run (port 8743, `--port` at export to
   change it), keeps a copy of the project's machine state in `backup/`, and checks the file equals
   the decisions key by key.
6. `node scripts/review/findings.js --dir <run>` — what docgen, the compiler or the spellchecker
   still flags (accepted findings and unchanged strings aren't asked again). When it lists strings:
   the `translation-findings` workflow with `{dir, tool, count}`, then
   `node scripts/review/apply-final.js --dir <run> <project>` for each project.
7. `npm run cli -- --data-dir <run>/dg-scratch/data check <config>` for each project — exit 0.
8. Copy `<run>/terms.md` back to `scripts/review/terms/<code>.md` when the term agent changed it,
   and commit each repo's `<lang>.json` and `<lang>.accepted.json`.

**Never chain an apply after a check through a pipe** (`check … | tail && apply`): the pipe's exit
code is the tail's, so a failed check doesn't stop the apply (the 2026-10-17 run's one slip).

## Only the new strings

The same steps with `--new` at export: only keys with no translation and no proposal. Run the review
with `terms: false` and `batches: [1]`, and verify with `verifiers: 1` — a translator and a refuting
verifier. Findings and apply-final as above.

## Cost and requirements

- Claude Code with the Workflow tool; no GPU, no model in docgen (the scratch server loads none).
- The 2026-10-17 whole run: 10 agents, about 2.3 M subagent tokens, about an hour. A run of a few
  dozen new strings: 2 agents, about 200 k tokens, a few minutes.
- `npm install` in docgen (the dev dependencies: `nspell`, `dictionary-<code>`,
  `@intlify/message-compiler` at the apps' vue-i18n version). Another language needs
  `lang/<code>.md` and, for spelling hints, `dictionary-<code>`.
