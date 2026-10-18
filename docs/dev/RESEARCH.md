<!-- SPDX-License-Identifier: MIT -->
# Research register — what we already know, and where the proof is (just_ai_i18n_docgen)

**Read the section for your subject before researching anything** — before reading code to
answer a question, before measuring, before briefing an agent. Then grep `docs/plans` for
anything newer. The shared AI stack's facts (the kit, llama.cpp, the memory arbiter) are in
[the kit's register](../../../just-core/docs/dev/RESEARCH.md).

## The rule (family-wide, decided 2026-10-04)

The user: *"why do we keep re researching stuff, we need a primary research doc that we point to
so we dont keep duplicating or forgeting what we have done in the past"* — approved "your rec on
all go". The kit's register carries the rule in full; in short:

- **Before research:** read the subject's section here and grep `docs/plans`. An agent's brief
  carries that section and the line *"don't re-derive these; re-check one only if the code it
  cites changed after its date"*.
- **After research:** its facts land here in the same change. A research doc with no entry here
  is not done. The family guard (`../just-core/scripts/check-family.js`, check 15) fails
  any `docs/plans/YYYY-MM-DD-*.md` dated 2026-10-04 or later that this page does not link, and
  any link here that points nowhere.
- **Filled as each subject comes up.** Until then a subject's records are indexed below, so
  they can at least be found.
- One fact per bullet, then *how it was checked and when* (measured · code · web · git · record
  · agent), then where the proof is. A fact that turns out wrong is rewritten, ending "(was: …
  until <date>)".

## Automatic translation review: tools (2026-10-17)

Asked because the user wants the Spanish review done with little human interaction ("find tools
… or if need be we make tools but i want an agentic worflow").

- **docgen already has the deterministic layer and two second opinions:**
  - the checks (placeholders, plural halves, glossary, punctuation, numbers);
  - the probe (CLI only);
  - the confirmation pass for identical strings;
  - the terminology flag;
  - escalation to a stronger preset.

  It has no score of whether a translation is good, and nothing applies a string without a
  human. — *code and `docs/verification.md`, read 2026-10-17.*
- **Learned quality-estimation (QE) models, reference-free:**
  - COMETKiwi and xCOMET (Unbabel; XL 3.5B, XXL 10.7B) are under a non-commercial licence.
  - MetricX-24 Hybrid (Google; mT5, QE mode included) is Apache-2.0.

  All are trained on WMT sentence and paragraph data, a poor match for one-word UI labels, and
  all run in Python on the GPU. — *web: huggingface.co/google/metricx-24-hybrid-large-v2p6;
  inten.to's metric comparison; unbabel.com, read 2026-10-17.*
- **The LLM judge is the field's standard method: GEMBA-MQM.** An LLM marks error spans with an
  MQM category and severity. Its span precision against human annotators is low (9.0% reported).
  MQM-APE filters it: the judge post-edits each error, and only errors whose fix improves the
  string are kept, which raised reliability across eight LLMs. Generative judges do best on
  frontier models; open models under 30B are "viable" (CompactQE, EAMT 2026). — *web:
  arxiv 2310.13988, 2409.14335; aclanthology 2026.eamt-1.9, read 2026-10-17.*
- **No maintained open-source tool runs the whole loop** (review, fix, re-check, apply).
  - LocaleCI scores each string but is under FSL-1.1.
  - internationalizer and Lingo.dev validate keys and interpolation.
  - Lingoport is commercial.

  — *web search 2026-10-17; repos not yet read.*
- **Spellchecking in Node:** `nspell` 2.1.5 (MIT, wooorm; Hunspell-compatible) and
  `dictionary-es` 4.0.0 (GPL-3.0 OR LGPL-3.0 OR MPL-1.1). They catch a non-word such as
  "reviravones" with no model. — *npm registry, read 2026-10-17.*
- **The agentic review, run 2026-10-17 on the three catalogs** (4,810 strings: JustWrite 3,052,
  the kit 1,480, docgen 278), Claude agents only, no GPU:
  - a term sheet (1 agent, 201 rows), each term decided from the catalogs' own strings;
  - 6 reviewers (about 800 strings each) listed 1,282 decisions: 797 fixes, a pick in each of the
    628 strings where the file's Spanish and docgen's proposal differed, and 27 new
    translations. By category: terminology 562, accuracy 267, fluency 180, locale 63, format 7.
    The 5 critical: "Unload model" rendered "download", a string cut off mid-sentence, two lost
    `{'}'}` braces, and "Undismiss" rendered "Dismiss";
  - 2 verifiers (the MQM-APE filter, prompted to refute) upheld 1,234 and rewrote 48, 42 of them
    one capitalisation pattern ("P. ej." after a full stop); none went back to an unreviewed
    candidate;
  - a last agent ruled on the 430 strings docgen or the spellchecker still flagged: 2 fixed, 428
    accepted with a reason;
  - about 2.3 M subagent tokens and about an hour of wall time.

  — *measured 2026-10-17; the scripts and outputs were in the session's scratchpad.*
- **The spellchecker is a hint, not a gate:** it flagged 189 strings at export, and nearly every
  hit was a valid word it lacks (preajuste, autoguardado, verb forms with an attached pronoun);
  "reviravones" was the one real non-word. — *measured 2026-10-17.*
- **docgen's placeholder and bracket checks count across the whole string.** A Spanish string
  that adds plural forms its English doesn't need ("{n} encontrado | {n} encontrados" for "{n}
  found") reads as `placeholder-changed` and `brackets`, though vue-i18n renders one form (it
  picks it from the named `n`: the kit's RESEARCH §8). `checkPlural` itself runs only when the
  source has the separator (`checks.js:55`). The 17 such strings were accepted as correct. —
  *code, and measured 2026-10-17.*

---

## Records not yet distilled

Indexed by subject so they can be found; their facts move into a section above when work next
touches the subject. History in [`../plans/archive/`](../plans/archive/) is not listed.

**Consistency across the family** —
[`2026-08-04-consistency-sweep.md`](../plans/2026-08-04-consistency-sweep.md).

**The measured evidence behind every check and rule** — the retired Node original,
https://github.com/delebash/just-ai-help (`docs/HANDOFF.md`; archived).
