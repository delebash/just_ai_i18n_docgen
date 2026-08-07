# Dev docs — start here (just_ai_i18n_docgen)

Read in this order:

1. **`../../CLAUDE.md`** — the working rules, the "what bites" list (proposals-only
   writes, the engine never signs off, shielding is a substitution, one resolver,
   config-anchored paths), and every pointer.
2. **`TASKS.md`** — the live tracker. **`IDEAS.md`** — the backlog.
3. **`../plans/2026-08-04-consistency-sweep.md`** — the live family-consistency
   enforcement list + the QuickSetup surgery resumption notes (the next build
   chunk). Closed history: `../plans/archive/`.
4. **The family standard** — `../../../just-llm-runner/docs/app-structure.md`
   (this app is its reference implementation; §11 the standard chrome, §13 the
   docs convention).
5. **The shared stack** — `../../../just-llm-runner/docs/dev/README.md` (the kit +
   server this app embeds).
6. **The measured evidence behind the checks** — the retired Node original's
   HANDOFF (archived: https://github.com/delebash/just-ai-help).
7. **The review workspace API** — `../../server/just_ai_i18n_docgen/api/workspace_api.py`
   (routes; the Workspace class + write rules stay in `../workspace.py` — the one
   resolver, two doors: workspace + CLI).

User-facing docs live at `../*.md`, indexed by `../toc.json` and served in-app via
the kit Help drawer (written 2026-08-04 from the code-first audit). Update them in
the SAME change that alters anything a user sees.
