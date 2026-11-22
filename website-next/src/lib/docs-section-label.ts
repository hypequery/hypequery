/**
 * Section shown after a docs page's title, by the page's file path under `docs/`. The file path is used rather
 * than the URL because route groups like `(self-host)/(serve)` publish at the docs root, where the URL carries no
 * section. First match wins, so the more specific prefixes come first.
 */
const SECTION_LABELS: [pathPrefix: string, label: string][] = [
  ['python/(datasets)/', 'Python datasets'],
  ['python/(serve)/', 'Python Serve'],
  ['python/reference/', 'Python reference'],
  ['python/', 'Python'],
  ['cloud/', 'Cloud'],
  ['(getting-started)/cloud/', 'Cloud'],
  ['(typescript)/(get-started)/', 'TypeScript SDK'],
  ['(typescript)/(datasets)/', 'Datasets'],
  ['(typescript)/(query-builder)/', 'Query builder'],
  ['(self-host)/(serve)/', 'Serve'],
  ['(typescript)/(reference)/', 'Reference'],
  ['(self-host)/mcp/', 'MCP'],
  ['(self-host)/react/', 'React'],
];

export function docsSectionLabel(path: string): string | null {
  return SECTION_LABELS.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null;
}

/**
 * The `<title>` text for a docs page, before the layout's `| hypequery docs` suffix. A `seoTitle` in frontmatter
 * wins; otherwise the nav title gets its section ("Overview · MCP") unless the title already names it.
 */
export function docsPageTitle(page: { path: string; data: { title: string; seoTitle?: string } }): string {
  if (page.data.seoTitle) return page.data.seoTitle;
  const { title } = page.data;
  const section = docsSectionLabel(page.path);
  if (!section || title.toLowerCase().includes(section.toLowerCase())) return title;
  return `${title} · ${section}`;
}
