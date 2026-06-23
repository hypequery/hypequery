import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';

// Static, regenerated only at build time.
export const revalidate = false;

type Entry = { title: string; url: string; description?: string };

// Group a doc URL by its first path segment after `/docs`.
// `/docs/datasets/overview` -> `datasets`; `/docs/quick-start` -> `Guides`.
function sectionOf(url: string): string {
  const rest = url.replace(/^\/docs\/?/, '');
  const parts = rest.split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : 'Guides';
}

const SECTION_ORDER = ['Guides', 'query-building', 'datasets', 'mcp', 'react', 'reference'];

const SECTION_TITLES: Record<string, string> = {
  Guides: 'Guides',
  'query-building': 'Query building',
  datasets: 'Datasets',
  mcp: 'MCP',
  react: 'React',
  reference: 'Reference',
};

export function GET() {
  const groups = new Map<string, Entry[]>();

  for (const page of source.getPages()) {
    const section = sectionOf(page.url);
    const list = groups.get(section) ?? [];
    list.push({
      title: page.data.title,
      // Link to the clean-markdown version so an LLM gets prose, not HTML.
      url: absoluteUrl(`/llms.mdx${page.url}`).toString(),
      description: page.data.description,
    });
    groups.set(section, list);
  }

  const sections = [...groups.keys()].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const lines: string[] = [
    '# hypequery',
    '',
    '> Type-safe analytics layer for ClickHouse: a typed query builder, a semantic datasets layer, an HTTP/OpenAPI serve runtime, React hooks, and an MCP server for agents.',
    '',
    'Each link below points to the clean Markdown version of the page. The full corpus is available at /llms-full.txt.',
    '',
  ];

  for (const section of sections) {
    lines.push(`## ${SECTION_TITLES[section] ?? section}`, '');
    const entries = groups.get(section)!.sort((a, b) => a.title.localeCompare(b.title));
    for (const e of entries) {
      lines.push(`- [${e.title}](${e.url})${e.description ? `: ${e.description}` : ''}`);
    }
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
