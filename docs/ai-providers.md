# Set up the AI engine

Open **AI Settings** in the sidebar. The page is the family's shared AI area:
providers & models, routing by feature, usage, and the server console.

## Quick Setup — the four steps

The wizard detects your hardware, proposes a model that fits it, and applies the
choice: **detect → confirm → apply → done**. It downloads two things the first
time: the llama.cpp engine (the program that runs models) and the model weights.
Both show live progress bars with working Cancel/Retry.

**Updating the engine.** An **Update** button appears beside the built-in provider when
there is a newer engine than yours. It offers one of two builds, whichever is newer: the
build this version of the app is tested with, or the build named by llama.cpp's newest
official release. Hover the button to see which. Before the new engine replaces the one you
have, the app checks that it starts *and* that it accepts the settings the app launches
models with; if it fails either, your current engine is kept and the message says what it
refused. If the newer release has no download for your kind of graphics card, the app says
so and changes nothing. The old build is removed only once the new one is working. A newer
engine is not automatically faster — a release can improve one kind of model and set
another back — so Update is always your click.

**The cache-sharing offer.** If another app in this family (JustWrite, JustVoice)
already downloaded AI files on this machine, the wizard offers to share them
instead of downloading again. Saying yes re-points this app at the sibling's cache
— **nothing on disk moves**, and the answer is reversible.

**First contact is a one-time offer.** When a project is loaded and no AI provider
is set up yet, the app shows the family's once-ever "Set up AI features" dialog —
Run Quick Setup (local, private & free), Connect an online provider, or Skip for
now. Whatever you pick, it never appears again; the AI page remains the manual door.

**A set-up machine is told the truth.** Once a default exists, the AI page's band
reads "Local AI is set up — *model* is the default · Re-run Quick Setup" (the
"built-in llama.cpp provider only" scope note stays beside it), and re-running
opens on an "Already set up" screen offering only *Change model* or *Close* —
nothing changes until you apply. The `?quicksetup=1` deep link stays away once a
default provider exists.

## Why the model list is short

The catalog here shows **translation-measured models only** — models this tool's
own checks were run against. The general-purpose writing catalog the family's
other apps use is deliberately suppressed: a model that writes lovely prose can
still mangle placeholders.

## Online providers

Any OpenAI-compatible provider (or OpenAI/Anthropic/Gemini directly) can be added
under Providers & models — add the base URL and key, set it as default, and runs
route through it instead of the local engine.

## Routing by feature

The **Routing by feature** tab shows which engine preset each feature uses —
`translate`, `review` (back-translation deliberately uses the SAME engine the
translation used), and `confirm`. Selecting one opens its Lab: the feature's
prompt, which you can edit and save for every run (see
[AI features](ai-features.md)), and the preset surface below it (model,
temperature, samplers, save/load presets, "Use in production") — where you'd
point a feature at a stronger model.

To try a prompt, pick a language under **Test input → Insert from language…**.
The Lab fills the prompt's parts from a small live sample of your project, shielded
exactly as a run shields them, so a test sends what a real run sends:
`translate` takes the first strings still waiting for that language (on a
finished language, already-translated ones), `confirm` a string that came back
unchanged, `review` a translated one. With no project loaded, **Sample** fills a
small built-in example instead. The links under the test input —
**"Change what this prompt says:" → Context & glossary** (Setup) and **Per-key
notes** (Review) — go to the data those parts come from.

These three features answer in strict JSON, so their preset's thinking stays off
for them: a reasoning block would break the answer.
