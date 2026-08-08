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
translation used), and `confirm`. Selecting `translate` or `confirm` shows the
*real* generated prompt, read-only (`review` has no preview — it routes only): prompts here are built by the pipeline for each string, so the
preview is for understanding and test-tuning, never something that saves. The
preset surface below it (model, temperature, samplers, save/load presets, "Use in
production") is live and is where you'd point a feature at a stronger model.

To experiment with wording, **Edit copies for this test** unlocks editable copies
inside the test columns — they run once and are never saved (every real run
rebuilds its own prompt); **Restore generated** re-seeds the columns from the
generated prompt, and the sample line always names what fed the preview and when
it was built. To change what the prompt *really* says, follow the links under it —
**"Change what this prompt says:" → Context & glossary** (Setup) and **Per-key
notes** (Review) — that data is what the builder assembles on every run. On a language that's already fully translated there's nothing
pending to sample, so the preview samples already-translated keys and says so —
the Lab still renders and tuning still works on a finished project.
