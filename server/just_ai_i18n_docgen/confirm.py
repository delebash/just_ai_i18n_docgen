# SPDX-License-Identifier: MIT
"""The confirmation pass — asking the engine about strings that came back unchanged.

Ported from just-ai-help's `server/confirm.js`, measurements intact. `untranslated`
fires when target == source, and a string comparison cannot separate four situations:
a glyph ("A", "H2"), a name that stays English ("EPUB"), a word the language shares
("Color"), and THE MODEL SKIPPED IT ("books" should be "libros"). Only the fourth is a
bug, and it hides inside a wall of the other three. The candidate set is free — the
translate run already proved everything it CHANGED was translatable.

MEASURED (JustWrite catalogue, 2026-07-31): 71 genuinely-identical keys → 57 cleared;
20/20 planted long skips caught, 37/40 short ("?", "OK", "pan" falsely cleared — a
~7.5% false-clear rate on short strings, which is exactly why a cleared key stays
VISIBLE and a human still presses the button).

WHY IT NEVER WRITES A TRANSLATION: of 10 proposals, "{n} w" → "{n} min" invented
minutes, "TODO" → "TODO POR HACER" mangled a do-not-translate term, and "elevator
pitch" got two different answers in one run. A proposal is shown, never applied.

THE ENGINE NEVER SIGNS OFF. Both outcomes are annotations in `.just-ai-i18n-docgen-state.json`; nothing
here writes `<lang>.accepted.json` — that is the human record. A "same" verdict
PRE-TICKS a row so seventy keys are one click; the approval recorded is still a
person's, with their name on it.

WHY NOT ASK TWICE: tried, and it agreed with itself confidently on BOTH wrong answers
(4 disagreements of 71). Single pass.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable

from .accepted import acceptance_hash
from .shieldlib import parse_items

# The code the confirmation pass reasons about. Only `untranslated` has this ambiguity.
CONFIRM_CODE = "untranslated"


def build_confirm_prompt(*, target_lang: str, context: str = "",
                         do_not_translate: list[str] | None = None) -> str:
    """Names the four situations explicitly rather than asking "is this right?" — a
    model asked to judge itself agrees with itself. Asked to TRANSLATE, it does the job
    it is good at, and answering "SAME" becomes a deliberate refusal, not a shrug."""
    never = (
        f"\nThese terms stay exactly as they are and are always SAME: "
        f"{', '.join(do_not_translate)}."
        if do_not_translate else ""
    )
    ctx = f" from {context}" if context else ""
    return f"""You are checking ONE user-interface string{ctx}.

A translator was asked to translate it from English into {target_lang} and returned it UNCHANGED.
Decide which of these happened.

It is genuinely unchanged when:
  - it is not words — a button glyph ("A", "H2", "B"), a unit ("5s", "12 w"), a symbol
  - it is a product, brand or file-format name that stays English (EPUB, JSON, RAG)
  - {target_lang} simply uses the same word (for Spanish: Color, Error, total)

It was SKIPPED when the string is ordinary text that has a perfectly good {target_lang} word.
"books" is not {target_lang}. "Save" is not {target_lang}.{never}

Reply with a single item whose translation field is EXACTLY one of:
  SAME                  — if it is genuinely unchanged
  the {target_lang}     — if it was skipped, give the correct translation"""


def is_same_verdict(answer: str, source: str) -> bool:
    """Echoing the source back counts as SAME — 15 of 71 answered that way in the
    measurement, and scoring an echo as a proposed translation would turn the pass's
    best answers into false alarms."""
    def norm(s):
        return re.sub(r"[.\s]+$", "", str(s or "").strip())

    a = norm(answer)
    return bool(re.fullmatch(r"same", a, re.IGNORECASE)) or a == norm(source)


def make_ask(feature: str = "confirm") -> Callable[[str, str], str]:
    """The default transport: ONE key per call through the resolved preset — never
    batched, because a batch is how the original skip happened and asking inside
    another batch invites the model to repeat it for the same reason."""
    from .engine import make_send

    send = make_send(feature)

    def ask(system: str, source: str) -> str:
        user = f"Translate items: {json.dumps([{'id': 0, 'text': source}])}"
        answer = parse_items(send(system, user)).get(0)
        if not isinstance(answer, str):
            # ValueError on purpose (TRY004 wants TypeError): the MODEL's reply is what
            # is invalid, and confirm_identical routes it into `failed` like any error.
            raise ValueError("no item 0 in the reply")  # noqa: TRY004
        return answer

    return ask


def confirm_identical(*, keys: list[str], source_flat: dict, target_flat: dict,
                      target_lang: str, context: str = "",
                      do_not_translate: list[str] | None = None,
                      ask: Callable[[str, str], str],
                      on_progress: Callable[[dict], None] | None = None) -> dict:
    """Runs the pass over every candidate key.

    Returns {"cleared": [...], "proposed": [...], "failed": [...]}:
      cleared  — the model says correct-as-is. An ANNOTATION that pre-ticks the review
                 row; it never reaches <lang>.accepted.json on its own.
      proposed — the model thinks it was skipped, and what it would have written. NEVER applied.
      failed   — the engine errored. Left as a finding, exactly like an exhausted retry.

    `ask` is injected because the routing decision (cleared vs proposed vs failed) is
    the part worth asserting, and it should be assertable with no model running."""
    system = build_confirm_prompt(target_lang=target_lang, context=context,
                                  do_not_translate=do_not_translate)
    cleared, proposed, failed = [], [], []

    for key in keys:
        src = source_flat[key]
        try:
            answer = ask(system, src)
            if is_same_verdict(answer, src):
                cleared.append({"key": key, "src": src, "dst": target_flat.get(key)})
            else:
                proposed.append({"key": key, "src": src, "dst": target_flat.get(key),
                                 "suggestion": answer})
        except Exception as e:  # noqa: BLE001 — an engine error is a routed outcome
            failed.append({"key": key, "src": src, "error": str(e)})
        if on_progress:
            on_progress({"done": len(cleared) + len(proposed) + len(failed),
                         "total": len(keys)})
    return {"cleared": cleared, "proposed": proposed, "failed": failed}


def attach_confirmations(findings: list[dict], verdicts: dict,
                         source_flat: dict, target_flat: dict) -> list[dict]:
    """Hangs the pass's annotation on the finding it belongs to, so the report and the
    review workspace show the same thing without either calling an engine. A verdict
    whose hash no longer matches is IGNORED — the same expiry an acceptance follows:
    edit either string and the machine's opinion retires itself. The field is named
    `confirmed`, not `accepted`: it pre-ticks a row for a human, it does not stand in
    for one."""
    if not verdicts:
        return findings
    out = []
    for f in findings:
        if f["code"] != CONFIRM_CODE or f["key"] not in verdicts:
            out.append(f)
            continue
        v = verdicts[f["key"]]
        live = acceptance_hash(key=f["key"], code=CONFIRM_CODE,
                               src=source_flat.get(f["key"], ""),
                               dst=target_flat.get(f["key"], ""))
        if v["hash"] != live:
            out.append(f)
            continue
        annotated = {**f, "confirmed": v["verdict"], "confirmedBy": v["engine"]}
        if v.get("suggestion"):
            annotated["suggestion"] = v["suggestion"]
        out.append(annotated)
    return out
