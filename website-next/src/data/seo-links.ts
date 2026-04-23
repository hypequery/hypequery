export type SeoLink = {
  label: string;
  href: string;
};

export type SeoLinkGroup = {
  title: string;
  links: SeoLink[];
};

export const seoFooterGroups: SeoLinkGroup[] = [
  {
    title: 'Product',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Quick Start', href: '/docs/quick-start' },
      { label: 'Query Builder', href: '/clickhouse-query-builder' },
      { label: 'React', href: '/clickhouse-react' },
      { label: 'Next.js', href: '/clickhouse-nextjs' },
    ],
  },
  {
    title: 'ClickHouse Guides',
    links: [
      { label: 'ClickHouse TypeScript', href: '/clickhouse-typescript' },
      { label: 'ClickHouse Analytics', href: '/clickhouse-analytics' },
      { label: 'Multi-Tenant Analytics', href: '/clickhouse-multi-tenant-analytics' },
      { label: 'ClickHouse MCP', href: '/clickhouse-mcp' },
    ],
  },
  {
    title: 'Compare',
    links: [
      { label: 'hypequery vs ClickHouse Client', href: '/compare/hypequery-vs-clickhouse-client' },
      { label: 'hypequery vs Kysely', href: '/compare/hypequery-vs-kysely' },
      { label: 'ClickHouse Query Builders', href: '/blog/clickhouse-query-builder-typescript' },
    ],
  },
  {
    title: 'Use Cases',
    links: [
      { label: 'Use Cases', href: '/use-cases' },
      { label: 'Internal Product APIs', href: '/use-cases/internal-product-apis' },
      { label: 'Multi-Tenant SaaS', href: '/use-cases/multi-tenant-saas' },
    ],
  },
];

export const homepageResourceLinks: SeoLink[] = [
  { label: 'ClickHouse TypeScript', href: '/clickhouse-typescript' },
  { label: 'ClickHouse Query Builder', href: '/clickhouse-query-builder' },
  { label: 'ClickHouse React', href: '/clickhouse-react' },
  { label: 'ClickHouse Next.js', href: '/clickhouse-nextjs' },
  { label: 'ClickHouse Analytics', href: '/clickhouse-analytics' },
  { label: 'ClickHouse MCP', href: '/clickhouse-mcp' },
];
