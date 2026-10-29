# TASKS — the live open-work tracker (just_ai_i18n_docgen)

> **THIS is the live tracker** — same charter as JW's `docs/dev/TASKS.md`. An item
> carries the APPROVED DECISION TEXT: what was shown to the user and approved, pasted
> at approval time, complete enough to code from without re-deriving what was decided
> (the rule: the global `~/.claude/CLAUDE.md`). Deeper decided detail may live in a detail doc the
> item points to — **read that doc before coding the item**. Close = delete — git
> keeps history. A tracker line is a claim, not evidence — verify against code.

## The family releases together [2026-10-29]
RULED:  the user (relayed from JustWrite's session, 2026-10-29): "you dont understand we have several apps i want all
        kit work done for all apps before we release any app, i want to relase all apps that we are working on now but
        not until all kit work is done by each app that means each app is complete bugs fixed featrues done all tasks
        ideas done or removed from list" — and in the kit's session: "dont release as kit works is still not done".
        docgen releases only with every family app, on one kit commit (the kit's TASKS, "The family releases
        together…", just-core 684ee36). Until then a release workflow runs as a dry run only (`publish: false`).
