# Set up the AI engine

Open **AI Settings** in the sidebar. The page is the family's shared AI area:
providers & models, routing by feature, usage, and the server console.

## Quick Setup — the four steps

The wizard detects your hardware, proposes a model that fits it, and applies the
choice: **detect → confirm → apply → done**. It downloads two things the first
time: the llama.cpp engine (the program that runs models) and the model weights.
Both show live progress bars with working Cancel/Retry.

**The cache-sharing offer.** If another app in this family (JustWrite, JustVoice)
already downloaded AI files on this machine, the wizard offers to share them
instead of downloading again. Saying yes re-points this app at the sibling's cache
— **nothing on disk moves**, and the answer is reversible.

The wizard appears once via the Home welcome or a `?quicksetup=1` link, and stays
away once a default provider exists.

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
translation used), and `confirm`. Selecting a feature shows the *real* generated
prompt, read-only: prompts here are built by the pipeline for each string, so the
preview is for understanding and test-tuning, never something that saves. The
preset surface below it (model, temperature, samplers, save/load presets, "Use in
production") is live and is where you'd point a feature at a stronger model.
