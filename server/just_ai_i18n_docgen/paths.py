# SPDX-License-Identifier: MIT
"""Where everything lives. ONE module, because path resolution was the single largest
source of confusion in the Node tool and it was spread across four files that disagreed.

THE RULE: every path resolves against the CONFIG FILE'S OWN DIRECTORY, never against the
working directory. What that fixes, measured rather than guessed: `localesDir` used to
resolve against wherever you typed the command (why every documented command began with a
`cd`), and the cache resolved the same way — run from the wrong folder and the tool
silently started with NO cache and re-translated the whole catalogue, which cost 27
minutes and 464 hand-corrected keys on 2026-07-31.

THE LAYOUT this enables — the tool's whole footprint in a host app is one visible folder:

    <app>/just-ai-i18n-docgen/           <- next to package.json, obvious to a newcomer
      config.json                 <- the four fields
      es.accepted.json            <- reviewer verdicts       (committed)
      es.notes.json               <- per-key knowledge       (committed)
      es.probe.json               <- second-pass measurement (not committed)
      .just-ai-i18n-docgen-cache.json             <- disposable              (not committed)

Engine connections and API keys are NOT here — they live in the shared LLM stack's DB
(machine state), which in this rewrite is what replaced the Node tool's settings.json.

Keeping review files out of `locales/` is not tidiness: that folder is loaded by the host
app, and the fix for "adding a language needs three code edits" is to glob it — a plain
*.json glob over the old layout registers a phantom language called "es.accepted".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

CACHE_FILE = ".just-ai-i18n-docgen-cache.json"

_SIDECAR_RE = re.compile(r"\.(accepted|notes|probe)\.json$")


@dataclass(frozen=True)
class ProjectPaths:
    config_dir: Path
    locales_dir: Path
    source_language: str
    source_file: Path
    sidecar_dir: Path
    cache_path: Path

    def target_file(self, lang: str) -> Path:
        return self.locales_dir / f"{lang}.json"

    def accepted_file(self, lang: str) -> Path:
        return self.sidecar_dir / f"{lang}.accepted.json"

    def notes_file(self, lang: str) -> Path:
        return self.sidecar_dir / f"{lang}.notes.json"

    def probe_file(self, lang: str) -> Path:
        return self.sidecar_dir / f"{lang}.probe.json"


def project_paths(config_path: str | Path, cfg: dict) -> ProjectPaths:
    """Everything derived from one config file path.

    `source` names the source FILE ("../src/i18n/locales/en.json"). Its folder is the
    locale folder and its basename is the source language, so that single field replaces
    the folder + sourceLanguage pair — nothing has to agree with anything else, because
    there is only one fact. Older folder-shaped configs (`locales`/`localesDir` +
    `sourceLanguage`) are still read, so upgrading invalidates nothing."""
    config_dir = Path(config_path).resolve().parent

    if cfg.get("source"):
        src = Path(cfg["source"])
        source_file = src if src.is_absolute() else (config_dir / src).resolve()
        locales_dir = source_file.parent
        source_language = source_file.name.removesuffix(".json")
    else:
        rel = cfg.get("locales") or cfg.get("localesDir")
        if not rel:
            raise ValueError(f'config at {config_path} has no "source" — it must name your en.json')
        rel_p = Path(rel)
        locales_dir = rel_p if rel_p.is_absolute() else (config_dir / rel_p).resolve()
        source_language = cfg.get("sourceLanguage", "en")
        source_file = locales_dir / f"{source_language}.json"

    # Review artefacts sit beside the config. If a project already keeps them in the
    # locales dir — where every version before 2026-07-31 put them — that location wins,
    # so upgrading never orphans a reviewer's verdicts. The choice is made ONCE for the
    # whole project, never per file: deciding per file split a real catalogue across two
    # folders, and "where are my review files" must have one answer.
    legacy_in_use = (
        locales_dir != config_dir
        and locales_dir.is_dir()
        and any(_SIDECAR_RE.search(f.name) for f in locales_dir.iterdir())
    )
    sidecar_dir = locales_dir if legacy_in_use else config_dir

    return ProjectPaths(
        config_dir=config_dir,
        locales_dir=locales_dir,
        source_language=source_language,
        source_file=source_file,
        sidecar_dir=sidecar_dir,
        cache_path=config_dir / CACHE_FILE,
    )
