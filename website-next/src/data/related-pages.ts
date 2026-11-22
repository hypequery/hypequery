import { comparePages } from '@/data/compare-pages';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import type { HubLink } from '@/components/hub-page';
import { semanticLayerHub, semanticLayerSpokes } from '@/data/semantic-layer-pages';

// The related-pages block at the foot of every /compare/* and /semantic-layer/*
// page: the section hub, a few sibling pages, and the docs that turn a
// comparison into working code. One list, so the docs links stay identical
// across both sections.

export const productDocsLinks: HubLink[] = [
  {
    href: '/docs/quick-start/api-and-dashboard',
    title: 'Serve an API and a dashboard',
    description: 'A dataset served as an authenticated endpoint with OpenAPI, charted with typed React hooks.',
  },
  {
    href: '/docs/datasets/multi-tenancy',
    title: 'Multi-tenancy',
    description: 'Tenant keys, trusted tenant context, and why queries without a tenant fail.',
  },
  {
    href: '/docs/datasets/measures',
    title: 'Measures',
    description: 'Sums, counts, distinct counts and derived measures defined once per dataset.',
  },
  {
    href: '/docs/datasets/relationships',
    title: 'Relationships',
    description: 'belongsTo and hasOne joins, queryable one hop deep without hand-written SQL.',
  },
  {
    href: '/docs/datasets/caching',
    title: 'Caching',
    description: 'A result cache keyed by query meaning and tenant, with TTL and stale-while-revalidate.',
  },
  {
    href: '/docs/datasets/tool-generation',
    title: 'Tool generation',
    description: 'Dataset tools for OpenAI, the Vercel AI SDK and MCP, with SQL redacted by default.',
  },
  {
    href: '/docs/agents/quickstart',
    title: 'Add AI chat to your app',
    description: 'Tenant-scoped analytics tools for the agent inside your product, no text-to-SQL.',
  },
  {
    href: '/docs/mcp/quickstart',
    title: 'Connect via MCP',
    description: 'Give Claude, Cursor or another MCP client governed access to a ClickHouse table.',
  },
];

const compareHub: HubLink = {
  href: '/compare',
  title: 'All comparisons',
  description: 'Every hypequery comparison, with who each tool suits and when hypequery is the better pick.',
};

// Comparisons about putting analytics in front of customers. Everything else
// under /compare is about ClickHouse clients and developer tooling.
const embeddedAnalyticsSiblings: HubLink[] = [
  ...embeddedAnalyticsComparePages.map((page) => ({ href: page.href, title: page.title, description: page.description })),
  ...comparePages
    .filter((page) => page.slug === 'hypequery-vs-metabase' || page.slug === 'hypequery-vs-cube')
    .map((page) => ({ href: page.href, title: page.title, description: page.verdict.split('. ')[0] + '.' })),
];

const developerToolSiblings: HubLink[] = comparePages
  .filter((page) => page.slug !== 'hypequery-vs-metabase')
  .map((page) => ({ href: page.href, title: page.title, description: page.verdict.split('. ')[0] + '.' }));

/** Up to `count` siblings, starting after the current page so links spread across the cluster. */
function rotate(list: HubLink[], currentPath: string, count: number) {
  const index = list.findIndex((link) => link.href === currentPath);
  const ordered = index === -1 ? list : [...list.slice(index + 1), ...list.slice(0, index)];
  return ordered.filter((link) => link.href !== currentPath).slice(0, count);
}

/** The hub plus every other spoke for a /semantic-layer/* page, then the ClickHouse page and the Cube comparison. */
export function semanticLayerRelatedLinks(currentPath: string): HubLink[] {
  return [
    ...[semanticLayerHub, ...semanticLayerSpokes]
      .filter((page) => page.href !== currentPath)
      .map((page) => ({ href: page.href, title: page.label, description: page.description })),
    {
      href: '/clickhouse-semantic-layer',
      title: 'ClickHouse semantic layer',
      description: 'Define datasets, measures and tenant keys for ClickHouse in TypeScript or Python.',
    },
    {
      href: '/compare/hypequery-vs-cube',
      title: 'hypequery vs Cube',
      description: 'A code-first library compared with a standalone semantic layer service.',
    },
  ];
}

/** The hub plus five sibling comparisons for a /compare/* page. */
export function compareRelatedLinks(currentPath: string): HubLink[] {
  const inEmbedded = embeddedAnalyticsSiblings.some((link) => link.href === currentPath);
  const siblings = inEmbedded ? embeddedAnalyticsSiblings : developerToolSiblings;
  return [compareHub, ...rotate(siblings, currentPath, 5)];
}
