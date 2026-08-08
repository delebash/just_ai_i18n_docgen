// The Help content adapter over docs/*.md — the host half of the kit Help system
// (configureHelp in main.js; the drawer-only minimal shape: no full-pane reader
// route yet, so onOpenFull/onOpenWeb stay unset and the kit hides those buttons).
// The adapter LOGIC (README→index aliasing, lazy load + cache, TOC titles) is
// the kit's makeDocsHelpAdapter — one implementation for the family, replacing
// this file's smaller re-implementation. What stays here is what vite resolves
// relative to THIS file: the import.meta.glob over the corpus and the toc import.
import { makeDocsHelpAdapter } from "@delebash/llm-ui";
import toc from "../../docs/toc.json";

export const { loadDoc, hasDoc, titleForSlug } = makeDocsHelpAdapter(
  import.meta.glob("../../docs/*.md", { query: "?raw", import: "default" }),
  toc,
);
