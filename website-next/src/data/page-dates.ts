/**
 * Last substantive update for hand-built marketing pages, keyed by path.
 *
 * One source for the date a page shows, its `dateModified` structured data,
 * and its sitemap `<lastmod>`. Bump the date here when you change a page's
 * content, not for layout or styling tweaks.
 */
const pageUpdated: Record<string, string> = {
  '/embedded-analytics': '2026-11-14',
  '/compare/embedded-analytics-typescript': '2026-11-14',
  '/compare/embedded-analytics-platforms': '2026-11-14',
  '/compare/embedded-analytics-pricing': '2026-11-12',
  '/compare/luzmo-alternatives': '2026-11-12',
  '/compare/hypequery-vs-embeddable': '2026-11-12',
  '/cube-js-alternative': '2026-11-12',
  '/clickhouse-saas-analytics': '2026-11-12',
  '/semantic-layer': '2026-11-10',
  '/semantic-layer/dbt-metricflow': '2026-11-10',
  '/semantic-layer/snowflake-semantic-views': '2026-11-10',
  '/semantic-layer/databricks-metric-views': '2026-11-10',
  '/semantic-layer/open-semantic-interchange': '2026-11-10',
  '/semantic-layer/open-source-tools': '2026-11-13',
  '/semantic-layer/ai-agents': '2026-11-14',
  '/semantic-layer/access-control': '2026-11-14',
  '/semantic-layer/analytics-mcp-server': '2026-11-14',
  '/semantic-layer/dbt-semantic-layer-alternatives': '2026-11-14',
  '/compare/build-vs-buy-embedded-analytics': '2026-11-14',
  // Seeded 2026-11-14 from each page file's last commit, so every marketing page
  // has a sitemap <lastmod>. Bump these by hand from here on.
  '/': '2026-11-09',
  '/clickhouse': '2026-11-09',
  '/clickhouse-js': '2026-11-10',
  '/clickhouse-nodejs': '2026-11-10',
  '/clickhouse-dashboard': '2026-11-10',
  '/clickhouse-product-analytics': '2026-11-14',
  '/clickhouse-real-time-analytics': '2026-11-14',
  '/clickhouse-api': '2026-11-10',
  '/clickhouse-audit-log': '2026-11-14',
  '/clickhouse-time-series': '2026-11-14',
  '/clickhouse-semantic-layer': '2026-11-14',
  '/clickhouse-orm': '2026-11-14',
  '/clickhouse-openapi': '2026-11-14',
  '/clickhouse-schema': '2026-11-14',
  '/clickhouse-typescript': '2026-11-14',
  '/clickhouse-python': '2026-11-14',
  '/clickhouse-python-analytics': '2026-11-14',
  '/clickhouse-fastapi': '2026-11-14',
  '/python-semantic-layer': '2026-11-14',
  '/clickhouse-python-multi-tenant': '2026-11-14',
  '/clickhouse-python-mcp': '2026-11-14',
  '/fastapi-react-analytics': '2026-11-14',
  '/clickhouse-django': '2026-11-14',
  '/clickhouse-flask': '2026-11-14',
  '/clickhouse-pandas': '2026-11-14',
  '/clickhouse-sqlalchemy': '2026-11-14',
  '/clickhouse-query-builder': '2026-11-14',
  '/type-safe-sql-typescript': '2026-11-10',
  '/clickhouse-mcp': '2026-11-14',
  '/clickhouse-react': '2026-11-10',
  '/clickhouse-nextjs': '2026-11-10',
  '/clickhouse-analytics': '2026-11-10',
  '/clickhouse-multi-tenant-analytics': '2026-11-10',
  '/use-cases': '2026-11-02',
  '/use-cases/internal-product-apis': '2026-11-02',
  '/use-cases/multi-tenant-saas': '2026-11-01',
  '/tinybird-alternative': '2026-11-14',
  '/contact-us': '2026-07-13',
};

/** The page's last update (YYYY-MM-DD). Throws at build time when a page is missing from the map. */
export function updatedFor(path: string): string {
  const date = pageUpdated[path];
  if (!date) throw new Error(`No updated date for ${path}; add it to src/data/page-dates.ts`);
  return date;
}

/** The last update for `path`, or undefined when the page is not tracked here. */
export function maybeUpdatedFor(path: string): string | undefined {
  return pageUpdated[path];
}
