import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';
import { comparePages } from '@/data/compare-pages';

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

// Product pages that answer "which tool should I use" questions. These have no
// Markdown copy, so they link to the HTML page.
const PRODUCT_PAGES: Entry[] = [
  { title: 'Cube.js alternative for ClickHouse', url: '/cube-js-alternative', description: 'A Cube.js alternative for ClickHouse with no Cube server, Redis cache, or YAML: hypequery is a TypeScript or Python library that lives in your codebase.' },
  { title: 'Tinybird alternative', url: '/tinybird-alternative', description: 'hypequery and your own ClickHouse give you typed analytics APIs with no data ingestion into a third-party platform and no per-query pricing.' },
  { title: 'MooseStack alternative', url: '/moosestack-alternative', description: 'MooseStack has reached end of life. Migrate typed ClickHouse queries, semantic metrics, APIs, React hooks, and MCP tools to hypequery.' },
  { title: 'Multi-tenant SaaS analytics', url: '/use-cases/multi-tenant-saas', description: 'Build customer-facing ClickHouse analytics with tenant scoping and role checks that live in one reviewable backend path.' },
  { title: 'Internal product APIs', url: '/use-cases/internal-product-apis', description: 'Add ClickHouse analytics to the backend you already run without rewriting your public API surface first.' },
];

const SECTION_ORDER = ['Guides', 'query-building', 'datasets', 'python', 'mcp', 'react', 'reference', 'cloud'];

const SECTION_TITLES: Record<string, string> = {
  Guides: 'Guides',
  'query-building': 'Query building',
  datasets: 'Datasets',
  mcp: 'MCP',
  react: 'React',
  reference: 'Reference',
  python: 'Python SDK (beta)',
  cloud: 'Cloud (not live yet: planned hosted service, no sign-up available)',
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
    '> The analytics backend for ClickHouse. Connect your ClickHouse and ship analytics for your customers, each seeing only their own data. Open-source SDKs for TypeScript and Python (beta): semantic datasets, an HTTP/OpenAPI serve runtime, typed React hooks, and an MCP server for agents. TypeScript also includes a type-safe ClickHouse query builder. hypequery cloud, a hosted option, is not live yet.',
    '',
    'Each link below points to the clean Markdown version of the page. The full corpus is available at /llms-full.txt.',
    '',
  ];

  lines.push('## Compare', '');
  for (const page of comparePages) {
    lines.push(`- [${page.title}](${absoluteUrl(`/llms.mdx/compare/${page.slug}`).toString()}): ${page.verdict}`);
  }
  lines.push('', '## Alternatives and use cases', '');
  for (const e of PRODUCT_PAGES) {
    lines.push(`- [${e.title}](${absoluteUrl(e.url).toString()}): ${e.description}`);
  }
  lines.push('');

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
