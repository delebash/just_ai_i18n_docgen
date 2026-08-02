# SPDX-License-Identifier: MIT
"""Deriving a project's config from ITS en.json — the code behind the setup tab.

Ported from just-ai-help's `server/init.js`. One derivation for the path box's live
validation AND the save, so a config cannot depend on which door you came through.
A generator, not a template: it can LOOK at your strings — the source file gives the
locale folder and the source language, the folder gives the targets, the strings give
glossary candidates. `context` is the one thing only you know.

ONE DELIBERATE CHANGE from the Node version: there is NO `engine` field. engines.json
is gone — which engine a feature runs is an ENGINE PRESET in the shared stack's DB
(one-source), assigned on the AI-features page, not a per-project config value.

Placeholder syntax and plural separator are REPORTED, never written — they are read
from en.json on every run, and seeing them proves the tool understood your catalogue
before an hour of engine time proves it did not.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .infer import infer_placeholder, infer_plural_separator
from .jsonio import flatten

CONFIG_DIR = "just-ai-help"
CONFIG_NAME = "config.json"

_LOCALE_FILE = re.compile(r"^([a-z]{2}(?:-[A-Za-z]{2,4})?)\.json$")


def find_project_root(start_dir: str | Path, marker: str = "package.json") -> Path | None:
    """The nearest ancestor holding a package.json — what every JS tool does, and the
    difference between the config landing somewhere visible and it landing five
    directories deep beside the strings. None for a non-JS project; the caller then
    requires an explicit out dir rather than guessing."""
    d = Path(start_dir).resolve()
    while True:
        if (d / marker).exists():
            return d
        if d.parent == d:
            return None
        d = d.parent


def locale_codes_in(dir_: str | Path) -> list[str]:
    """Locale files in a folder: `<code>.json`, never a tooling sidecar like
    `es.accepted.json`."""
    p = Path(dir_)
    if not p.is_dir():
        return []
    out = []
    for f in p.iterdir():
        m = _LOCALE_FILE.match(f.name)
        if m:
            out.append(m.group(1))
    return sorted(out)


# An inner dot or plus is part of the word — `llama.cpp`, `C++`, `Vue3` — but a
# TRAILING one is sentence punctuation, so "Studio." and "Studio" count as one thing.
_WORD = re.compile(r"[^\W\d_][\w]*(?:[.+-][\w]+)*", re.UNICODE)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?:])\s+|\n")


def glossary_candidates(values: list[str], *, min_count: int = 3, limit: int = 12) -> list[str]:
    """Terms worth PROPOSING for the glossary: capitalised words that recur and are
    never merely a sentence opener. Suggestions only — the glossary is the most
    dangerous field in the config: every term is also a blanket instruction, and on a
    real 1,965-key catalogue adding `AI` turned 48 CORRECT translations into findings.
    A machine cannot tell a brand from a word that starts a sentence; it proposes, a
    human decides."""
    counts: dict[str, int] = {}
    mid_sentence: set[str] = set()
    for v in values:
        for chunk in _SENTENCE_SPLIT.split(str(v)):
            words = [w for w in _WORD.findall(chunk) if w[:1].isupper()]
            stripped = chunk.strip()
            first = words[0] if words and stripped.startswith(words[0]) else None
            for i, w in enumerate(words):
                counts[w] = counts.get(w, 0) + 1
                # Capitalised anywhere but the opening position means it is capitalised
                # because of WHAT IT IS, not because a sentence started.
                if i > 0 or w != first:
                    mid_sentence.add(w)
    ranked = [(w, n) for w, n in counts.items()
              if n >= min_count and w in mid_sentence and len(w) > 1]
    ranked.sort(key=lambda kv: (-kv[1], kv[0]))
    return [w for w, _n in ranked[:limit]]


def plan_init(source_path: str | Path, *, out: str | Path | None = None,
              targets: list[str] | None = None, context: str | None = None,
              glossary: list[str] | None = None) -> dict:
    """Everything derivable from one en.json, with nothing written to disk."""
    source_file = Path(source_path).resolve()
    if not source_file.exists():
        raise FileNotFoundError(f"no such file: {source_file}")

    locales_dir = source_file.parent
    source_language = source_file.name.removesuffix(".json")
    flat = flatten(json.loads(source_file.read_text(encoding="utf-8")))
    values = [v for v in flat.values() if isinstance(v, str)]
    if not values:
        raise ValueError(f"{source_file} holds no strings")

    existing = [c for c in locale_codes_in(locales_dir) if c != source_language]
    root = Path(out).resolve() if out else find_project_root(locales_dir)
    if root is None:
        raise ValueError(
            f"no package.json above {locales_dir} — pass an output dir to say where "
            "the config should go"
        )

    config_dir = root / CONFIG_DIR
    config_path = config_dir / CONFIG_NAME
    # The SOURCE FILE, relative to the config — its folder is the locale folder and its
    # name the source language, so no second field can disagree. Forward slashes read
    # the same on every platform.
    import os

    source_rel = os.path.relpath(source_file, config_dir).replace(os.sep, "/")

    cfg = {
        "source": source_rel,
        "targets": targets if targets is not None else existing,
        "context": context if context is not None else "",
        "glossary": glossary if glossary is not None else [],
    }

    return {
        "cfg": cfg,
        "configPath": str(config_path),
        "configDir": str(config_dir),
        "root": str(root),
        "localesDir": str(locales_dir),
        "sourceLanguage": source_language,
        "keyCount": len(flat),
        "sourceFlat": flat,
        "existingTargets": existing,
        "placeholder": infer_placeholder(values),
        "pluralSeparator": infer_plural_separator(values),
        "candidates": glossary_candidates(values),
    }


def write_init(plan: dict, *, force: bool = False) -> str:
    """Writes the config, refusing to clobber one that is already there."""
    config_path = Path(plan["configPath"])
    if config_path.exists() and not force:
        raise FileExistsError(f"{config_path} already exists — pass force to overwrite it")
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(plan["cfg"], indent=2, ensure_ascii=False) + "\n",
                           encoding="utf-8")
    return str(config_path)


def gitignore_lines() -> list[str]:
    """The lines a host app should add to .gitignore. Reported, never written — it is
    their file. Committed alongside: config.json, <lang>.accepted.json,
    <lang>.notes.json — those are your work and travel with the repo."""
    return [
        f"{CONFIG_DIR}/*.probe.json",
        f"{CONFIG_DIR}/.jah-cache.json",
        f"{CONFIG_DIR}/.jah-probe-cache.json",
        f"{CONFIG_DIR}/.jah-state.json",
    ]
