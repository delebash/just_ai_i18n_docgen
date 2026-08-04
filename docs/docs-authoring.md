# Help docs → locale keys

The **Docs** page explains this feature in-app; here is the full contract.

Your app's help pages (markdown in your `docs/` folder) can carry front-matter
that this tool turns into locale keys — so a page's lede sentence and field hints
ship translated with everything else:

```markdown
---
lede: One sentence shown under the page title.
hints:
  fieldName: The short hint shown beside that field.
---
```

Run `extract <config>` and every `lede:` becomes `lede.<page>` and every hint
`hints.<page>.<field>` in your source locale file — from there they translate,
review, and verify like any other key. `extract --check` verifies without writing
(a CI gate: fails when docs and keys drift).

## The supported YAML — deliberately tiny

`lede:` plus ONE level of `hints:` mappings; plain scalars, quoted when they
contain `:` or start with a quote. **Not supported, on purpose:** tabs, lists,
`|`/`>` block scalars, deeper nesting, duplicate keys. The parser refuses these
loudly rather than guessing — a parser that silently "succeeds" ships a blank
hint into every language.

## Ownership

The tool owns everything under its two prefixes (`lede.*`, `hints.*` by default)
and touches nothing else in your locale file. The prefixes and the docs folder
are configurable in `config.json` (`docsDir`, `ledePrefix`, `hintsPrefix`) — by
hand; there is no UI for them.
