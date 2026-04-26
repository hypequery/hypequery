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
      { label: 'ClickHouse TypeScript', href: '/clickhouse-typescript' },
      { label: 'Query Builder', href: '/clickhouse-query-builder' },
      { label: 'Analytics', href: '/clickhouse-analytics' },
      { label: 'Semantic Layer', href: '/clickhouse-semantic-layer' },
      { label: 'Schema Types', href: '/clickhouse-schema' },
    ],
  },
  {
    title: 'Frameworks',
    links: [
      { label: 'ClickHouse JavaScript', href: '/clickhouse-js' },
      { label: 'ClickHouse Node.js', href: '/clickhouse-nodejs' },
      { label: 'ClickHouse React', href: '/clickhouse-react' },
      { label: 'ClickHouse Next.js', href: '/clickhouse-nextjs' },
      { label: 'REST API', href: '/clickhouse-rest-api' },
      { label: 'OpenAPI', href: '/clickhouse-openapi' },
    ],
  },
  {
    title: 'Use Cases',
    links: [
      { label: 'ClickHouse Dashboard', href: '/clickhouse-dashboard' },
      { label: 'Product Analytics', href: '/clickhouse-product-analytics' },
      { label: 'Real-Time Analytics', href: '/clickhouse-real-time-analytics' },
      { label: 'Audit Log', href: '/clickhouse-audit-log' },
      { label: 'Time Series', href: '/clickhouse-time-series' },
      { label: 'SaaS Analytics', href: '/clickhouse-saas-analytics' },
      { label: 'Multi-Tenant Analytics', href: '/clickhouse-multi-tenant-analytics' },
    ],
  },
  {
    title: 'Compare',
    links: [
      { label: 'Comparison Hub', href: '/compare' },
      { label: 'vs ClickHouse Client', href: '/compare/hypequery-vs-clickhouse-client' },
      { label: 'vs Kysely', href: '/compare/hypequery-vs-kysely' },
      { label: 'ClickHouse Query Builders', href: '/blog/clickhouse-query-builder-typescript' },
    ],
  },
  {
    title: 'More',
    links: [
      { label: 'Use Cases', href: '/use-cases' },
      { label: 'Internal Product APIs', href: '/use-cases/internal-product-apis' },
      { label: 'Multi-Tenant SaaS', href: '/use-cases/multi-tenant-saas' },
      { label: 'ClickHouse MCP', href: '/clickhouse-mcp' },
      { label: 'ClickHouse ORM', href: '/clickhouse-orm' },
    ],
  },
  {
    title: 'Functions',
    links: [
      { label: 'Function Reference', href: '/clickhouse/functions' },
      { label: 'toStartOfDay', href: '/clickhouse/functions/toStartOfDay' },
      { label: 'toStartOfInterval', href: '/clickhouse/functions/toStartOfInterval' },
      { label: 'uniq', href: '/clickhouse/functions/uniq' },
      { label: 'quantile', href: '/clickhouse/functions/quantile' },
      { label: 'groupArray', href: '/clickhouse/functions/groupArray' },
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
