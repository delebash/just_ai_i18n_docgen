# SPDX-License-Identifier: MIT
"""just-ai-i18n-docgen — the CLI door. Thin by design: every decision lives in
service.py, shared verbatim with the workspace API, so a report and an escalation can
never drift between doors.

    just-ai-i18n-docgen translate config.json            translate what changed, then check
    just-ai-i18n-docgen translate config.json --force    re-translate everything
    just-ai-i18n-docgen translate config.json --probe    second pass, flag disagreements
    just-ai-i18n-docgen translate config.json --no-confirm
    just-ai-i18n-docgen check config.json                check files on disk, NO engine.
                                                         Run this before you ship.
    just-ai-i18n-docgen escalate config.json <preset-id> re-do ONLY flagged keys
    just-ai-i18n-docgen accept config.json k1,k2 --by me record findings as reviewed-correct
"""

from __future__ import annotations

import argparse
import os
import sys
import time


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="just-ai-i18n-docgen", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    p_tr = sub.add_parser("translate", help="translate what changed, then check")
    p_tr.add_argument("config")
    p_tr.add_argument("--force", action="store_true")
    p_tr.add_argument("--probe", action="store_true")
    p_tr.add_argument("--no-confirm", action="store_true")

    p_ck = sub.add_parser("check", help="check the files on disk — no engine, deterministic")
    p_ck.add_argument("config")

    p_es = sub.add_parser("escalate", help="re-translate ONLY the flagged keys with another preset")
    p_es.add_argument("config")
    p_es.add_argument("preset_id")

    p_ac = sub.add_parser("accept", help="record current findings for keys as reviewed-correct")
    p_ac.add_argument("config")
    p_ac.add_argument("keys", help="comma-separated key list")
    p_ac.add_argument("--by", default=os.environ.get("JAH_REVIEWER", ""),
                      help="who is signing these off (or set JAH_REVIEWER)")

    args = ap.parse_args(argv)

    from .service import Project, accept_keys, run_check, run_escalate, run_translate

    project = Project(args.config)
    if project.inferred:
        print(f"Read from {project.paths.source_language}.json: {', '.join(project.inferred)}")

    if args.command == "translate":
        started = time.monotonic()
        result = run_translate(project, force=args.force, probe=args.probe,
                               no_confirm=args.no_confirm)
        print(f"Elapsed {time.monotonic() - started:.1f}s")
        check = run_check(project)
        return 1 if (result["hard_failures"] or check["failed"]) else 0

    if args.command == "check":
        return 1 if run_check(project)["failed"] else 0

    if args.command == "escalate":
        started = time.monotonic()
        run_escalate(project, args.preset_id)
        print(f"Elapsed {time.monotonic() - started:.1f}s")
        return 1 if run_check(project)["failed"] else 0

    if args.command == "accept":
        keys = [k.strip() for k in args.keys.split(",") if k.strip()]
        accept_keys(project, keys, by=args.by)
        return 0

    return 2  # unreachable: subparsers are required


if __name__ == "__main__":
    sys.exit(main())
