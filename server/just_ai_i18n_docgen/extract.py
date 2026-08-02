# SPDX-License-Identifier: MIT
"""Function 2 — author the help system ONCE, in the docs, and let it become locale keys.

Ported from just-ai-help's `server/extract.js`. The same sentence gets written three
times — the help article, the surface's lede, a field's hint — and three copies drift,
each into a different translation. The doc's front-matter is the single authoring home;
this extracts `lede:`/`hints:` into `lede.<slug>` / `hints.<slug>.<name>` in the SOURCE
locale — the same file the translator reads. docs → extract → en.json → translate →
es.json; a changed hint re-translates as an ordinary key delta, and the translator
never knows docs exist.

OWNERSHIP, and why it is narrow. This tool OWNS the two generated prefixes and nothing
else: on every run it removes every key under them and rewrites them from the docs, so
a deleted hint disappears instead of lingering forever in nine languages. Every other
key is untouched — a generator that can clobber hand-written copy is a generator nobody
dares run.

It runs at BUILD time. Runtime stays plain vue-i18n; nothing parses markdown in the app.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from .frontmatter import parse_front_matter
from .service import Project


def _is_flat(raw: dict) -> bool:
    """Locale files come in two shapes in the wild: genuinely nested objects and flat
    maps whose keys contain literal dots. DETECTED, never configured — guessing wrong
    would restructure the whole file, and a generator that reformats 800 hand-written
    keys to add two of its own is not one anyone runs twice."""
    return any("." in k for k in raw)


def _set_key(obj: dict, path: str, value: str, flat: bool) -> None:
    if flat:
        obj[path] = value
        return
    parts = path.split(".")
    node = obj
    for p in parts[:-1]:
        if not isinstance(node.get(p), dict):
            node[p] = {}
        node = node[p]
    node[parts[-1]] = value


def _count_leaves(o) -> int:
    if isinstance(o, dict):
        return sum(_count_leaves(v) for v in o.values())
    return 1


def _clear_prefix(obj: dict, prefix: str, flat: bool) -> int:
    """Every existing key under `prefix`, removed. Returns how many went."""
    if flat:
        doomed = [k for k in obj if k == prefix or k.startswith(f"{prefix}.")]
        for k in doomed:
            del obj[k]
        return len(doomed)
    if prefix not in obj:
        return 0
    n = _count_leaves(obj[prefix])
    del obj[prefix]
    return n


def run_extract(project: Project, *, check: bool = False, log: Callable = print) -> dict:
    """Reads every doc, regenerates the owned prefixes, writes (or under `check`,
    verifies without writing — the pre-ship contract: not "are the docs valid" but
    "does the committed locale match the docs"; a stale generated key is exactly as
    broken as a missing one, and neither is visible by reading either file alone).

    Returns {"keys": int, "removed": int, "changed": bool, "stale": bool}."""
    cfg = project.cfg
    docs_dir = (project.paths.config_dir / cfg.get("docsDir", "docs")).resolve()
    lede_prefix = cfg.get("ledePrefix", "lede")
    hints_prefix = cfg.get("hintsPrefix", "hints")

    if not docs_dir.is_dir():
        raise FileNotFoundError(
            f'No docs directory at {docs_dir} — set "docsDir" in your config.'
        )

    raw = json.loads(project.paths.source_file.read_text(encoding="utf-8"))
    flat = _is_flat(raw)

    files = sorted(f for f in docs_dir.iterdir() if f.name.endswith(".md"))
    generated: dict[str, str] = {}
    docs_with_fm = 0

    for f in files:
        slug = f.name.removesuffix(".md")
        try:
            data, _body = parse_front_matter(f.read_text(encoding="utf-8"))
        except ValueError as err:
            # Loud, and NAMES the file: a doc whose front-matter does not parse must not
            # be skipped silently, or its copy vanishes with nothing to notice.
            raise ValueError(f"{f.name}: {err}") from err
        if not data:
            continue
        docs_with_fm += 1

        lede = data.get("lede")
        if isinstance(lede, str) and lede.strip():
            generated[f"{lede_prefix}.{slug}"] = lede.strip()
        hints = data.get("hints")
        if isinstance(hints, dict):
            for name, text in hints.items():
                if isinstance(text, str) and text.strip():
                    generated[f"{hints_prefix}.{slug}.{name}"] = text.strip()

    before = json.dumps(raw, sort_keys=True)
    removed = _clear_prefix(raw, lede_prefix, flat) + _clear_prefix(raw, hints_prefix, flat)
    for k, v in generated.items():
        _set_key(raw, k, v, flat)
    changed = json.dumps(raw, sort_keys=True) != before

    n_lede = sum(1 for k in generated if k.startswith(f"{lede_prefix}."))
    n_hints = sum(1 for k in generated if k.startswith(f"{hints_prefix}."))
    log(f"{len(files)} doc(s), {docs_with_fm} with front-matter → {len(generated)} key(s)"
        f" ({n_lede} lede, {n_hints} hints), {removed} replaced")

    stale = False
    if check:
        if changed:
            stale = True
            log(f"STALE: {project.paths.source_file} does not match {docs_dir}. "
                f"Run: just-ai-i18n-docgen extract {project.config_path}")
        else:
            log("up to date")
    elif changed:
        Path(project.paths.source_file).write_text(
            json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        log(f"wrote {project.paths.source_file}")
    else:
        log("no change")

    return {"keys": len(generated), "removed": removed, "changed": changed, "stale": stale}
