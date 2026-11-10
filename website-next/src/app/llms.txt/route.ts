import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';
import { comparePages } from '@/data/compare-pages';
import { semanticLayerPages } from '@/data/semantic-layer-pages';
import { PRODUCT_DEFINITION } from '@/data/product';
import { docsPageTitle } from '@/lib/docs-section-label';

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
  { title: 'Embedded analytics for developers', url: '/embedded-analytics', description: 'What embedded analytics is, when to embed a BI tool and when to build, tenant isolation on ClickHouse, and 8 tools compared on embed model, licensing, self-hosting and pricing.' },
  { title: 'ClickHouse for TypeScript and Python developers', url: '/clickhouse', description: 'Hub for querying ClickHouse from application code: TypeScript and Python guides, frameworks, SQL patterns, the function reference, APIs and MCP.' },
  ...semanticLayerPages.map((page) => ({ title: page.label, url: page.href, description: page.description })),
  { title: 'ClickHouse semantic layer', url: '/clickhouse-semantic-layer', description: 'What a semantic layer is, and how to define one for ClickHouse in TypeScript or Python with typed datasets, tenant keys and time keys.' },
  { title: 'Cube.js alternative for ClickHouse', url: '/cube-js-alternative', description: 'A Cube.js alternative for ClickHouse with no Cube server, Redis cache, or YAML: hypequery is a TypeScript or Python library that lives in your codebase.' },
  { title: 'Tinybird alternative', url: '/tinybird-alternative', description: 'hypequery and your own ClickHouse give you typed analytics APIs with no data ingestion into a third-party platform and no per-query pricing.' },
  { title: 'Multi-tenant SaaS analytics', url: '/use-cases/multi-tenant-saas', description: 'Build customer-facing ClickHouse analytics with tenant scoping and role checks that live in one reviewable backend path.' },
  { title: 'Internal product APIs', url: '/use-cases/internal-product-apis', description: 'Add ClickHouse analytics to the backend you already run without rewriting your public API surface first.' },
];

// The pages an agent should read first, in order: the definition, both quick starts, then the dataset and MCP
// entry points. They are listed once, under "Start here", and left out of the sections below.
const START_HERE = [
  '/docs/what-is-hypequery',
  '/docs/quick-start',
  '/docs/python/quick-start',
  '/docs/why-hypequery',
  '/docs/core-concepts',
  '/docs/introduction',
  '/docs/python',
  '/docs/datasets/overview',
  '/docs/python/datasets/overview',
  '/docs/mcp/overview',
  '/docs/capabilities',
  '/docs/python/feature-status',
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

function entryLine(e: Entry): string {
  return `- [${e.title}](${e.url})${e.description ? `: ${e.description}` : ''}`;
}

export function GET() {
  const groups = new Map<string, Entry[]>();
  const startHere = new Map<string, Entry>();

  for (const page of source.getPages()) {
    const entry: Entry = {
      // Self-describing titles ("Overview · MCP"), since an entry is read out of its sidebar context.
      title: docsPageTitle(page),
      // Link to the clean-markdown version so an LLM gets prose, not HTML.
      url: absoluteUrl(`/llms.mdx${page.url}`).toString(),
      description: page.data.description,
    };
    if (START_HERE.includes(page.url)) {
      startHere.set(page.url, entry);
      continue;
    }
    const section = sectionOf(page.url);
    const list = groups.get(section) ?? [];
    list.push(entry);
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
    `> ${PRODUCT_DEFINITION}`,
    '',
    `Each docs link below points to the clean Markdown version of the page. The full corpus is one file: [llms-full.txt](${absoluteUrl('/llms-full.txt').toString()}). hypequery cloud, a planned hosted service, is not live yet.`,
    '',
    '## Start here',
    '',
  ];
  for (const url of START_HERE) {
    const entry = startHere.get(url);
    if (entry) lines.push(entryLine(entry));
  }

  lines.push('', '## Compare', '');
  for (const page of comparePages) {
    lines.push(`- [${page.title}](${absoluteUrl(`/llms.mdx/compare/${page.slug}`).toString()}): ${page.verdict}`);
  }
  lines.push('', '## Alternatives and use cases', '');
  for (const e of PRODUCT_PAGES) {
    lines.push(entryLine({ ...e, url: absoluteUrl(e.url).toString() }));
  }
  lines.push('');

  for (const section of sections) {
    lines.push(`## ${SECTION_TITLES[section] ?? section}`, '');
    const entries = groups.get(section)!.sort((a, b) => a.title.localeCompare(b.title));
    for (const e of entries) {
      lines.push(entryLine(e));
    }
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
