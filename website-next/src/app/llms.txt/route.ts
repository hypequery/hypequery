import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';
import { comparePages } from '@/data/compare-pages';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { semanticLayerPages } from '@/data/semantic-layer-pages';
import { exampleEntries, formatEntries, functionEntries, guideEntries, recipeEntries } from '@/lib/llms-index';
import { PRODUCT_DEFINITION } from '@/data/product';
import { docsPageTitle } from '@/lib/docs-section-label';
import { HTML_TWIN_ROOT } from '@/lib/markdown-twin';

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

// Product pages that answer "which tool should I use" questions. Each links to its
// Markdown twin, converted from the rendered page (src/app/llms.mdx/pages).
const PRODUCT_PAGES: Entry[] = [
  { title: 'hypequery homepage', url: '/', description: 'Overview: define metrics once in TypeScript or Python, then serve dashboards, APIs and agents from ClickHouse.' },
  { title: 'Embedded analytics for developers', url: '/embedded-analytics', description: 'What embedded analytics is, when to embed a BI tool and when to build, tenant isolation on ClickHouse, and 8 tools compared on embed model, licensing, self-hosting and pricing.' },
  { title: 'ClickHouse for TypeScript and Python developers', url: '/clickhouse', description: 'Hub for querying ClickHouse from application code: TypeScript and Python guides, frameworks, SQL patterns, the function reference, APIs and MCP.' },
  ...semanticLayerPages.map((page) => ({ title: page.label, url: page.href, description: page.description })),
  { title: 'ClickHouse semantic layer', url: '/clickhouse-semantic-layer', description: 'What a semantic layer is, and how to define one for ClickHouse in TypeScript or Python with typed datasets, tenant keys and time keys.' },
  ...embeddedAnalyticsComparePages.map((page) => ({ title: page.title, url: page.href, description: page.description })),
  { title: 'Embedded analytics for SaaS on ClickHouse', url: '/clickhouse-saas-analytics', description: 'How hypequery serves in-app dashboards, customer-facing APIs and AI agents from one typed, tenant-scoped model on ClickHouse.' },
  { title: 'Tinybird alternatives', url: '/tinybird-alternative', description: 'ClickHouse Cloud, self-hosted ClickHouse, Cube and hypequery compared as Tinybird alternatives for typed analytics APIs on ClickHouse you own.' },
  { title: 'ClickHouse TypeScript client for ClickHouse Cloud', url: '/clickhouse-typescript', description: 'The official @clickhouse/client, and how hypequery adds schema-generated types, typed queries and APIs on top of it.' },
  { title: 'ClickHouse query builder for TypeScript', url: '/clickhouse-query-builder', description: 'Schema-generated types, native ClickHouse syntax, and a path from one-off queries to reusable API definitions.' },
  { title: 'ClickHouse ORM', url: '/clickhouse-orm', description: 'Why Prisma, Drizzle and TypeORM do not support ClickHouse, and the typed query workflow to use instead.' },
  { title: 'ClickHouse API', url: '/clickhouse-api', description: 'ClickHouse\'s HTTP interface on ports 8123 and 8443 for raw SQL, versus an app-facing REST API with auth, validation and OpenAPI built from typed queries.' },
  { title: 'ClickHouse MCP server', url: '/clickhouse-mcp', description: 'A governed MCP server: agents query named datasets and metrics, never raw SQL. Connect Claude, Cursor or Codex from TypeScript or Python.' },
  { title: 'ClickHouse multi-tenant analytics', url: '/clickhouse-multi-tenant-analytics', description: 'Automatic tenant scoping, typed APIs and reusable query definitions for multi-tenant analytics on ClickHouse.' },
  { title: 'ClickHouse Python clients', url: '/clickhouse-python', description: 'clickhouse-connect, the official client, compared with clickhouse-driver, clickhouse-sqlalchemy and hypequery, with safe dynamic queries.' },
  { title: 'ClickHouse analytics in Python', url: '/clickhouse-python-analytics', description: 'Named measures, joins and tenant rules in Python, queried from jobs and notebooks and served to dashboards and agents.' },
  { title: 'Python semantic layer for ClickHouse', url: '/python-semantic-layer', description: 'Measures, dimensions, relationships and tenant rules as Python code, running inside your app with no YAML and no separate server.' },
  { title: 'ClickHouse with FastAPI', url: '/clickhouse-fastapi', description: 'Authenticated, tenant-scoped FastAPI endpoints over ClickHouse with request validation and rate limiting.' },
  { title: 'ClickHouse with Django', url: '/clickhouse-django', description: 'Shared, tenant-scoped ClickHouse definitions called from Django views and tasks, with the Django ORM kept for transactional data.' },
  { title: 'ClickHouse with Flask', url: '/clickhouse-flask', description: 'ClickHouse measures defined once in Python and queried per customer from Flask routes, with typed DataFrames for exports.' },
  { title: 'ClickHouse to pandas', url: '/clickhouse-pandas', description: 'Pull ClickHouse measures into pandas from the same definitions your product uses.' },
  { title: 'ClickHouse with SQLAlchemy', url: '/clickhouse-sqlalchemy', description: 'SQLAlchemy for ad hoc SQL against ClickHouse, hypequery for shared, tenant-scoped measures.' },
  { title: 'ClickHouse MCP server for Python backends', url: '/clickhouse-python-mcp', description: 'Expose Python-defined ClickHouse datasets to Claude, Cursor and other MCP clients; agents only see the endpoints they may call.' },
  { title: 'Multi-tenant ClickHouse analytics in Python', url: '/clickhouse-python-multi-tenant', description: 'Declare a tenant key once; every query is scoped to the caller, and queries without a trusted tenant are refused.' },
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
    `Each link below points to the clean Markdown version of the page where one exists. Any page under /docs, /blog, /compare, /examples, /recipes or /guides, and the homepage and product pages, also serves Markdown when requested with a .md suffix (/index.md for the homepage) or \`Accept: text/markdown\`. The full corpus is one file: [llms-full.txt](${absoluteUrl('/llms-full.txt').toString()}). hypequery cloud, a planned hosted service, is not live yet.`,
    '',
    '## Start here',
    '',
  ];
  for (const url of START_HERE) {
    const entry = startHere.get(url);
    if (entry) lines.push(entryLine(entry));
  }

  // After the start-here pages: the sub-indexes agents follow to runnable code.
  lines.push(`- [Examples](${absoluteUrl('/examples/llms.txt').toString()}): runnable apps over one seeded ClickHouse, scaffold with \`npx @hypequery/cli create <slug> -y\`.`);
  lines.push(`- [Recipes](${absoluteUrl('/recipes/llms.txt').toString()}): one question, one dataset, the SQL it generates.`);
  lines.push(`- [Guides](${absoluteUrl('/guides/llms.txt').toString()}): long-form ClickHouse guides with CI-tested SQL.`);
  lines.push(`- [ClickHouse functions](${absoluteUrl('/clickhouse/functions/llms.txt').toString()}): per-function pages with the typed hypequery equivalent.`);
  lines.push('');

  lines.push('## Examples', '', ...formatEntries(exampleEntries()), '');
  lines.push('## Recipes', '', ...(recipeEntries().length > 0 ? formatEntries(recipeEntries()) : ['- Coming soon: p95 latency, retention cohorts.']), '');
  lines.push('## ClickHouse guides', '', ...formatEntries(guideEntries()), '');
  lines.push('## ClickHouse functions', '', ...formatEntries(functionEntries()), '');

  lines.push('## Compare', '');
  for (const page of comparePages) {
    lines.push(`- [${page.title}](${absoluteUrl(`/llms.mdx/compare/${page.slug}`).toString()}): ${page.verdict}`);
  }
  lines.push('', '## Alternatives and use cases', '');
  for (const e of PRODUCT_PAGES) {
    lines.push(entryLine({ ...e, url: absoluteUrl(e.url === '/' ? HTML_TWIN_ROOT : `${HTML_TWIN_ROOT}${e.url}`).toString() }));
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
