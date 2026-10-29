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

## Waiting on the kit's finish list — the round's last two steps [2026-10-29]
WHY:    the close-out round (the user's go, 2026-10-29: "remeber kit work goes to kit session your rec on all go")
        built items 1–6 and verified them (RESEARCH, "docgen on §15–§18"); two steps take what the kit builds, on
        its finish list the user approved ("your rec on all … go", kit TASKS "Finish the kit", 7b015c9).
OPEN:   1. When the kit's template/scripts/start-packaged.js reads the launcher's name from server/package.json (its B):
           docgen takes the template's file as it is (its copy hard-codes just-ai-i18n-docgen-server, the one line).
        2. When start-packaged.js takes --data-dir <folder> (its C): that run on docgen's real data folder and
           JustWrite's project is the acceptance run before a commit (item 5 — the walk done by hand until then).
