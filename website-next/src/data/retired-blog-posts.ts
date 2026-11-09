/**
 * Blog posts merged into another page and removed. next.config.ts 301s each
 * slug to its destination, and the sitemap, blog index and RSS feed skip it,
 * because a CMS (Vercel Blob) copy of a removed seed post can outlive the
 * markdown file.
 */
export type RetiredBlogPost = {
  slug: string;
  destination: string;
};

const MULTI_TENANT = '/blog/embedded-analytics-clickhouse-multi-tenant-dashboards';
const DASHBOARDS = '/blog/building-dashboards-clickhouse-hypequery-nextjs';
const NODEJS = '/blog/add-clickhouse-analytics-nodejs-backend';
const TYPES = '/blog/clickhouse-typescript-type-problem';

export const retiredBlogPosts: RetiredBlogPost[] = [
  // Duplicates of the page Google ranks for the same searches (November 2026).
  { slug: 'does-clickhouse-have-an-orm', destination: '/clickhouse-orm' },
  { slug: 'clickhouse-query-builder-typescript', destination: '/clickhouse-query-builder' },
  { slug: 'clickhouse-react-hooks', destination: '/clickhouse-react' },
  { slug: 'clickhouse-materialized-views-typescript', destination: '/blog/a-guide-to-materialized-views-in-clickhouse' },
  // Under 50 impressions and no clicks (Search Console, August to November
  // 2026), merged into four guides or redirected to the page that ranks.
  { slug: 'multi-tenant-analytics-clickhouse-typescript', destination: `${MULTI_TENANT}#enforcing-tenancy-at-plan-time-with-datasets` },
  { slug: 'clickhouse-row-level-security-typescript', destination: `${MULTI_TENANT}#row-policies-vs-app-side-tenant-scoping` },
  { slug: 'saas-analytics-api-clickhouse-typescript', destination: `${MULTI_TENANT}#a-typed-analytics-api-for-your-dashboards` },
  { slug: 'clickhouse-real-time-dashboard-react', destination: `${DASHBOARDS}#step-5-typed-react-hooks-with-polling` },
  { slug: 'real-time-leaderboard-clickhouse-typescript', destination: `${DASHBOARDS}#a-real-time-leaderboard` },
  { slug: 'internal-analytics-tool-clickhouse-typescript', destination: `${DASHBOARDS}#step-3-a-read-only-page-is-just-a-server-component` },
  { slug: 'clickhouse-connection-pooling-nodejs', destination: `${NODEJS}#running-it-in-production` },
  { slug: 'clickhouse-testing-typescript', destination: `${NODEJS}#testing-clickhouse-queries` },
  { slug: 'clickhouse-sampling-typescript', destination: `${NODEJS}#sampling-for-fast-prototyping` },
  { slug: 'stop-writing-the-same-query-three-times', destination: `${TYPES}#define-each-query-once` },
  {
    slug: 'turn-your-clickhouse-schema-into-a-type-safe-analytics-layer-in-5-minutes',
    destination: `${TYPES}#the-fix-generate-types-from-the-live-schema`,
  },
  { slug: 'migrating-raw-sql-to-hypequery', destination: `${TYPES}#migrating-from-raw-sql-strings-one-query-at-a-time` },
  {
    slug: 'type-safe-sql-in-typescript-why-your-current-approach-is-failing-you-and-what-to-do-about-it',
    destination: '/type-safe-sql-typescript',
  },
  // /clickhouse-rest-api itself redirects to /clickhouse-api, so skip the hop.
  { slug: 'typed-rest-api-clickhouse', destination: '/clickhouse-api' },
  { slug: 'clickhouse-mcp-typescript', destination: '/clickhouse-mcp' },
  { slug: 'what-is-a-semantic-layer', destination: '/clickhouse-semantic-layer' },
];

export const retiredBlogSlugs: ReadonlySet<string> = new Set(retiredBlogPosts.map((post) => post.slug));
