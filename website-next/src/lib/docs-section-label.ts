/** Section shown after a docs page's title, by URL. The TypeScript root's top-level guides have none. */
const SECTION_LABELS: [prefix: string, label: string][] = [
  ['/docs/python/datasets/', 'Python datasets'],
  ['/docs/python/', 'Python'],
  ['/docs/cloud/', 'Cloud'],
  ['/docs/datasets/', 'Datasets'],
  ['/docs/mcp/', 'MCP'],
  ['/docs/react/', 'React'],
  ['/docs/query-building/', 'Query builder'],
  ['/docs/reference/', 'Reference'],
];

export function docsSectionLabel(url: string): string | null {
  if (url === '/docs/python' || url === '/docs/cloud') return null;
  return SECTION_LABELS.find(([prefix]) => url.startsWith(prefix))?.[1] ?? null;
}
