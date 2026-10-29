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

## Needs your ruling — docgen's e2e on the template's hermetic driver? [found 2026-10-29]
FOUND:  the kit's standard (`../just-core/docs/app-structure.md` §Q's test table): "Desktop e2e — the unpackaged app
        through Playwright's `_electron`, hermetic (§10)… Every test is hermetic: a temp data folder, `JUST_AI_HOME`
        pointed there, no network, no real model unless an env flag asks for one (`<APP>_REAL_*=1`)". The template's
        and house-paint's `e2e/lib/driver.js` do that (they start the app's own server on a temp folder, stop it with
        POST /v1/shutdown, refuse to run while something holds the port). docgen's (and JustWrite's) driver is the
        older design they were lifted from: it runs against the dev data folder and the server you start on
        JustWrite's real project (e2e/README.md) — your global rule: "Test against the user's real app, real data and
        real project — never a sandbox or scratch config unless asked." The two rules disagree; nothing was changed.
REC:    docgen takes the template's driver as it is (hermetic by default, a fixture project as its Setup create-flow
        test already builds), and the kit's own `<APP>_REAL_*` switch — `JUST_AI_I18N_DOCGEN_REAL_PROJECT=1` — runs the
        same suite against your real data and JustWrite's project, as today. Attack: it costs rewriting the smoke tests
        that read JustWrite's live state (the staged chip, the routing written by "quick setup RUNS"); without the
        switch the suite would stop testing your real project, which your rule forbids, hence the switch. JustWrite's
        driver has the same gap (its session's).
