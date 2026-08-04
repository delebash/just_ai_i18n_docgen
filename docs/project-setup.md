# Point it at your app (Setup)

Open **Setup** in the sidebar. You give the tool ONE fact: the path to your app's
**source locale file** (usually `en.json`). Its folder is the locale directory;
its basename is the source language. It's a path box, not a file picker, because
you'll usually paste a path from your editor.

## Check path — read before you spend engine time

Press **Check path**. The tool reads the file and reports what it found — *without
writing anything*: how many keys, the inferred placeholder syntax (`{name}`,
`%s`, …), the plural separator, which locale files already exist beside it and how
done each one is, and glossary candidates it spotted. If any of that looks wrong,
fix it here — a wrong placeholder inference would flag every translated string.

## The choices

- **Target languages** — pick from the list; each becomes a row on Home.
- **Context** — ONE sentence about your app ("A desktop writing app for
  novelists."). It rides every translation prompt. Changing it later re-translates
  from scratch — the translation cache is keyed on it.
- **Glossary — handle with care.** A glossary term is a *blanket rule*: "never
  translate this word, anywhere." That's exactly right for brand names and exactly
  wrong for common words — one wrong term once turned 48 correct translations into
  findings. Tick the suggested candidates you actually mean; leave the rest.

## What Save writes

**Save project** writes `just-ai-help/config.json` beside your app's
`package.json` and hot-loads it — no restart. The page also shows the
`.gitignore` lines to paste into your app's repo (the tool's cache and state
files stay out of git; the config and review records go in — see
[Your files](files-and-git.md)).
