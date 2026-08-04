// The Help content adapter over docs/*.md — the host half of the kit Help system
// (configureHelp in main.js; the drawer-only minimal shape: no full-pane reader
// route yet, so onOpenFull/onOpenWeb stay unset and the kit hides those buttons).
// Same pattern as JustWrite's services/helpDocs.js: Vite inlines the corpus at
// build time, toc.json supplies titles.
import toc from "../../docs/toc.json";

const pages = import.meta.glob("../../docs/*.md", { query: "?raw", import: "default" });

const bySlug = {};
for (const [path, loader] of Object.entries(pages)) {
  const m = path.match(/\/([^/]+)\.md$/);
  if (m) bySlug[m[1]] = loader;
}

const titles = {};
for (const group of toc) for (const item of group.items) titles[item.slug] = item.title;

export function hasDoc(slug) {
  return Boolean(bySlug[slug]);
}

export async function loadDoc(slug) {
  const loader = bySlug[slug];
  return loader ? await loader() : null;
}

export function titleForSlug(slug) {
  return titles[slug] || slug || "Help";
}
