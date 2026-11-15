import { semanticLayerPages } from '@/data/semantic-layer-pages';

/**
 * Hand-built, indexable marketing pages: the homepage, hubs, landing pages,
 * framework guides and use cases. They have no content source, so their sitemap
 * `<lastmod>` comes from src/data/page-dates.ts and their Markdown twin is
 * converted from the rendered HTML (src/app/llms.mdx/pages).
 *
 * Pages marked noindex (/clickhouse-express, -hono, -trpc, -graphql) stay out.
 * Section hubs (/blog, /compare, /examples, /changelog, /clickhouse/functions)
 * and the embedded analytics comparison pages (including /cube-js-alternative,
 * src/data/embedded-analytics-compare.ts) live with their section in
 * src/lib/sitemap/sections.ts.
 */
export const marketingPages: readonly string[] = [
  '/',
  '/clickhouse',
  '/embedded-analytics',
  ...semanticLayerPages.map((page) => page.href),
  '/clickhouse-js',
  '/clickhouse-nodejs',
  '/clickhouse-dashboard',
  '/clickhouse-product-analytics',
  '/clickhouse-real-time-analytics',
  '/clickhouse-api',
  '/clickhouse-audit-log',
  '/clickhouse-time-series',
  '/clickhouse-semantic-layer',
  '/clickhouse-orm',
  '/clickhouse-openapi',
  '/clickhouse-saas-analytics',
  '/clickhouse-schema',
  '/clickhouse-typescript',
  '/clickhouse-python',
  '/clickhouse-python-analytics',
  '/clickhouse-fastapi',
  '/python-semantic-layer',
  '/clickhouse-python-multi-tenant',
  '/clickhouse-python-mcp',
  '/fastapi-react-analytics',
  '/clickhouse-django',
  '/clickhouse-flask',
  '/clickhouse-pandas',
  '/clickhouse-sqlalchemy',
  '/clickhouse-query-builder',
  '/type-safe-sql-typescript',
  '/clickhouse-mcp',
  '/clickhouse-react',
  '/clickhouse-nextjs',
  '/clickhouse-analytics',
  '/clickhouse-multi-tenant-analytics',
  '/use-cases',
  '/use-cases/internal-product-apis',
  '/use-cases/multi-tenant-saas',
  '/tinybird-alternative',
  '/contact-us',
];
