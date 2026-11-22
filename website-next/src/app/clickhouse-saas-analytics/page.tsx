import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, HubSources, HubTable, type HubLink } from '@/components/hub-page';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { marketing } from '@/components/ui/marketing';
import { getGithubStars } from '@/lib/github-stars';
import { getNpmDownloadCounts } from '@/lib/npm-downloads';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

// This page was the "ClickHouse SaaS analytics" pillar, then "embedded analytics
// for SaaS". It now targets "clickhouse embedded analytics" at the same URL, so
// the existing links and any ranking history carry over. The vendor-neutral
// overview stays at /embedded-analytics; this page is the ClickHouse deep dive.
const PATH = '/clickhouse-saas-analytics';
const TITLE = 'ClickHouse Embedded Analytics: Architecture for SaaS';
const DESCRIPTION =
  'ClickHouse embedded analytics for SaaS: architectures, tenant isolation, row policies, quotas, query limits and caching, served to React and AI agents.';
const PUBLISHED = '2026-04-25';
const UPDATED = updatedFor(PATH);
// ClickHouse syntax and behaviour on this page were checked against clickhouse.com/docs on this date.
const VERIFIED_ON = 'November 22, 2026';

// Proof numbers are fetched at render time and cached for an hour; never hard-code them.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: TITLE,
    description: DESCRIPTION,
    images: ogImage('ClickHouse embedded analytics'),
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const inlineCode = 'font-mono text-[0.92em] text-text';

// Follows the MergeTree, materialized view and sparse index pages listed in Sources.
const tableDdl = `CREATE TABLE analytics.orders
(
    account_id  String,
    order_id    UInt64,
    status      LowCardinality(String),
    country     LowCardinality(String),
    amount      Decimal(18, 2),
    created_at  DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (account_id, created_at, order_id);`;

const rollupDdl = `CREATE TABLE analytics.orders_daily
(
    account_id  String,
    day         Date,
    status      LowCardinality(String),
    orders      UInt64,
    revenue     Decimal(18, 2)
)
ENGINE = SummingMergeTree
ORDER BY (account_id, day, status);

CREATE MATERIALIZED VIEW analytics.orders_daily_mv
TO analytics.orders_daily AS
SELECT
    account_id,
    toDate(created_at) AS day,
    status,
    count() AS orders,
    sum(amount) AS revenue
FROM analytics.orders
GROUP BY account_id, day, status;`;

// CREATE USER, CREATE ROW POLICY: syntax from the ClickHouse docs linked in Sources.
const rowPolicyDdl = `CREATE USER app_reader IDENTIFIED BY '...';

-- Applies to every request, whatever the tenant
CREATE ROW POLICY hide_internal ON analytics.orders
    USING account_id NOT IN ('internal', 'demo')
    TO app_reader;

-- Hard isolation for one tenant: its own user and policy
CREATE USER acme_reader IDENTIFIED BY '...';
CREATE ROW POLICY acme_only ON analytics.orders
    USING account_id = 'acme'
    TO acme_reader;`;

// CREATE SETTINGS PROFILE with MAX constraints and CREATE QUOTA: syntax from the ClickHouse docs linked in Sources.
const profileDdl = `CREATE SETTINGS PROFILE app_reader_profile SETTINGS
    readonly = 2,
    max_execution_time = 10 MAX 30,
    max_rows_to_read = 500000000 MAX 1000000000,
    max_bytes_to_read = 50000000000,
    max_result_rows = 100000,
    max_memory_usage = 4000000000 MAX 8000000000
TO app_reader;

CREATE QUOTA app_reader_quota
    FOR INTERVAL 1 minute MAX queries = 600, read_rows = 5000000000,
    FOR INTERVAL 1 hour MAX queries_per_normalized_hash = 2000
TO app_reader;`;

// Type-checked against @hypequery/clickhouse 2.15.0, @hypequery/datasets 0.30.0 and @hypequery/serve 0.25.0.
// `limits` and `cache` follow DatasetLimits in packages/datasets/src/types.ts and docs/datasets/caching.mdx.
const datasetCode = `import { createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';
import { db } from './client'; // your createQueryBuilder instance

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'account_id', // every query is filtered to one customer account
  timeKey: 'created_at',
  dimensions: {
    status: dimension.string(),
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    orders: measure.count('order_id'),
    revenue: measure.sum('amount'),
  },
  limits: { maxDimensions: 3, maxFilters: 10, maxResultSize: 1_000 },
});

export const analytics = createDatasetClient({
  queryBuilder: db,
  cache: { ttlMs: 60_000, staleWhileRevalidateMs: 300_000 },
});`;

// `cache` and `maxLimit` per entry: docs/datasets/serve-integration.mdx and docs/reference/api/runtime.mdx.
const serveCode = `import { initServe } from '@hypequery/serve';
import { db } from './client';
import { Orders } from './datasets';
import { verifySession } from './auth'; // your JWT or session check

const { serve } = initServe({
  // The tenant comes from the verified session, never from the request body.
  auth: async ({ request }) => verifySession(request.headers.authorization),
  tenant: { extract: (auth) => auth?.tenantId, required: true },
});

export const api = serve({
  queryBuilder: db,
  datasets: {
    orders: {
      dataset: Orders,
      requiredScopes: ['analytics:read'],
      cache: 60_000, // fresh for 60 s, keyed by tenant
      maxLimit: 100, // a larger limit is clamped, not rejected
    },
  },
});`;

// The error message is the one documented in docs/datasets/multi-tenancy.mdx.
const tenantTestCode = `import { expect, test } from 'vitest';
import { analytics, Orders } from './datasets';

test('a query without a tenant never runs', async () => {
  await expect(
    analytics.execute(Orders, { measures: ['revenue'] }),
  ).rejects.toThrow(/requires runtime tenant scoping/);
});

test('two tenants see their own totals', async () => {
  const acme = await analytics.execute(Orders, { measures: ['orders'] }, {
    runtime: { tenant: 'acme' },
  });
  const globex = await analytics.execute(Orders, { measures: ['orders'] }, {
    runtime: { tenant: 'globex' },
  });
  // Seed the two accounts with different row counts so a leak shows up here.
  expect(acme.data).not.toEqual(globex.data);
});`;

const patternRows = [
  [
    'Where the tenant filter lives',
    'In every query string your app sends',
    'In every handler, usually through a shared helper',
    'Once per dataset, added by the layer',
  ],
  [
    'What a missing filter does',
    'Returns every tenant’s rows',
    'Returns every tenant’s rows from that endpoint',
    'The query throws before reaching ClickHouse',
  ],
  [
    'Metric definitions',
    'Repeated in each query',
    'Repeated per endpoint unless you factor them out',
    'Named measures, reused by every endpoint',
  ],
  [
    'Cost of a new chart',
    'New SQL in the front-end path',
    'A new endpoint, validation and tests',
    'A request against an existing dataset',
  ],
  [
    'AI agent access',
    'Raw SQL, so the agent can skip the filter',
    'Hand-written tools per endpoint',
    'Tools generated from the same datasets',
  ],
  [
    'Good fit',
    'Internal tools with one trusted tenant',
    'A handful of fixed charts',
    'Many charts, a public API or agents',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is ClickHouse embedded analytics?',
    answer:
      'ClickHouse embedded analytics means the dashboards, exports, APIs and AI answers a product shows its own customers, served from ClickHouse and limited to each customer’s data. ClickHouse handles the aggregation; your application or an analytics layer handles authentication, the tenant filter and the shape of each request.',
  },
  {
    question: 'Is ClickHouse good for customer-facing analytics?',
    answer:
      'Yes, for aggregations over large event or order tables. A sorting key that starts with the tenant column lets ClickHouse skip other tenants’ data, and materialized views or projections keep the hottest charts cheap. It needs help with many small concurrent queries, which is where caching, settings profiles and quotas come in.',
  },
  {
    question: 'How do you isolate tenants in ClickHouse?',
    answer:
      'Use three layers. Put the tenant column first in ORDER BY so queries read only that tenant’s granules. Give the application a read-only user with row policies for rules that always apply. Then add the tenant filter in exactly one place in application code. hypequery does that last part with a tenant key on each dataset, and rejects queries that arrive without a tenant.',
  },
  {
    question: 'Can a ClickHouse row policy filter by the signed-in customer?',
    answer:
      'Only if each customer has its own ClickHouse user. A row policy is attached to users or roles, and it cannot see your application session. With one shared reader user, use row policies for global rules and apply the per-request tenant filter in your application or analytics layer.',
  },
  {
    question: 'How do you stop one customer’s dashboard from overloading ClickHouse?',
    answer:
      'Set limits in a settings profile for the reader user (max_execution_time, max_rows_to_read, max_memory_usage, max_result_rows) with MAX constraints so queries cannot raise them, add a quota for query counts, and cache results per tenant so a busy dashboard does not repeat the same query.',
  },
  {
    question: 'Is hypequery free?',
    answer:
      'Yes, the libraries are. Every hypequery package is Apache 2.0 and you deploy it with your own backend. hypequery cloud, the hosted option, is in early access with a waitlist and no published price.',
  },
];

const nextLinks: HubLink[] = [
  {
    href: '/embedded-analytics',
    title: 'Embedded analytics for developers',
    description: 'The vendor-neutral overview: embed a BI tool or build with your own components.',
  },
  {
    href: '/blog/embedded-analytics-clickhouse-multi-tenant-dashboards',
    title: 'Multi-tenant dashboards on ClickHouse',
    description: 'A worked build: schema, row policies, rollups and per-tenant limits.',
  },
  {
    href: '/blog/clickhouse-settings-for-application-backends',
    title: 'ClickHouse settings for application backends',
    description: 'The full settings profile an API user should have, setting by setting.',
  },
  {
    href: '/compare/build-vs-buy-embedded-analytics',
    title: 'Build vs buy embedded analytics',
    description: 'What each part costs to build, and when buying a platform wins.',
  },
  {
    href: '/compare/embedded-analytics-platforms',
    title: 'Embedded analytics platforms compared',
    description: 'Code-first layers, embedded BI and BI tools with embedding, side by side.',
  },
  {
    href: '/semantic-layer',
    title: 'What is a semantic layer?',
    description: 'Metrics, dimensions and joins defined once, and the main options compared.',
  },
  {
    href: '/docs/datasets/multi-tenancy',
    title: 'Dataset multi-tenancy docs',
    description: 'Tenant keys, runtime tenant context, and why execution fails closed.',
  },
  {
    href: '/docs/datasets/caching',
    title: 'Dataset caching docs',
    description: 'TTLs, stale-while-revalidate, tenant-safe keys and shared stores.',
  },
  {
    href: '/clickhouse-mcp',
    title: 'ClickHouse MCP',
    description: 'The same datasets as governed tools for Claude, Cursor and other agents.',
  },
];

const sources = [
  {
    vendor: 'ClickHouse docs',
    urls: [
      'https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes',
      'https://clickhouse.com/docs/data-modeling/projections',
      'https://clickhouse.com/docs/materialized-view/incremental-materialized-view',
      'https://clickhouse.com/docs/sql-reference/statements/create/row-policy',
      'https://clickhouse.com/docs/sql-reference/statements/create/settings-profile',
      'https://clickhouse.com/docs/operations/settings/constraints-on-settings',
      'https://clickhouse.com/docs/sql-reference/statements/create/quota',
      'https://clickhouse.com/docs/operations/settings/query-complexity',
      'https://clickhouse.com/docs/operations/settings/permissions-for-queries',
    ],
  },
];

/** App → hypequery → ClickHouse, with the three outputs. Plain HTML so the text is crawlable. */
function ArchitectureDiagram() {
  const box = 'rounded-lg border border-border-strong bg-bg-card px-4 py-3 text-sm';
  const arrow = 'select-none text-center font-mono text-text-dim';
  return (
    <figure className="rounded-xl border border-border bg-bg-alt/40 p-5 sm:p-8">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1.4fr_auto_1fr] lg:items-center">
        <div className={box}>
          <p className="font-medium text-text">Your SaaS app</p>
          <p className="mt-1 text-text-muted">Signs in the user and knows their account (tenant) and role.</p>
        </div>
        <p aria-hidden="true" className={arrow}>
          <span className="inline-block lg:-rotate-90">↓</span>
        </p>
        <div className={`${box} border-accent/60`}>
          <p className="font-medium text-text">hypequery datasets, in your repo</p>
          <ul className="mt-1 space-y-0.5 text-text-muted">
            <li>Measures, dimensions and joins, typed in TypeScript or Python</li>
            <li>Tenant key: one filter, applied to every query</li>
            <li>Limits, cache and scopes per dataset and endpoint</li>
          </ul>
        </div>
        <p aria-hidden="true" className={arrow}>
          <span className="inline-block lg:-rotate-90">↓</span>
        </p>
        <div className={box}>
          <p className="font-medium text-text">ClickHouse</p>
          <p className="mt-1 text-text-muted">
            ClickHouse Cloud, self-hosted, or chDB. A read-only user with a settings profile, quota and row policies.
          </p>
        </div>
      </div>
      <p aria-hidden="true" className={`${arrow} my-3`}>
        ↓ the same definitions serve ↓
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={box}>
          <p className="font-medium text-text">In-app dashboards</p>
          <p className="mt-1 text-text-muted">React hooks over typed endpoints; your own chart components.</p>
        </div>
        <div className={box}>
          <p className="font-medium text-text">Customer-facing API</p>
          <p className="mt-1 text-text-muted">REST endpoints with validation and an OpenAPI spec.</p>
        </div>
        <div className={box}>
          <p className="font-medium text-text">AI agents</p>
          <p className="mt-1 text-text-muted">An MCP server that exposes datasets as tools, scoped to one tenant.</p>
        </div>
      </div>
      <figcaption className="mt-5 text-xs leading-5 text-text-dim">
        One typed model between your app and ClickHouse. Dashboards, the public API and agents all read the same
        metric definitions and the same tenant rule.
      </figcaption>
    </figure>
  );
}

export default async function ClickHouseEmbeddedAnalyticsPage() {
  const [npmCounts, stars] = await Promise.all([getNpmDownloadCounts(), getGithubStars()]);
  const monthlyDownloads = npmCounts ? npmCounts.reduce((sum, count) => sum + count, 0) : null;

  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Embedded analytics', href: '/embedded-analytics' },
        { label: 'ClickHouse' },
      ]}
      eyebrow="ClickHouse embedded analytics"
      title="ClickHouse embedded analytics for SaaS"
      updated={UPDATED}
      lead={
        <p>
          How to serve customer-facing dashboards, APIs and AI agents from ClickHouse without leaking one
          customer’s data to another or letting one dashboard run up the bill. This guide covers table design, the
          three ways to put ClickHouse behind a product, tenant isolation, query limits, quotas and caching, with the
          SQL and the code for each.
        </p>
      }
      primaryCta={{ href: '#quickstart', label: 'Jump to the quickstart', target: 'ch_embedded_quickstart' }}
      secondaryCta={{ href: '#patterns', label: 'Compare architectures', target: 'ch_embedded_patterns' }}
      definition={{
        term: 'What is ClickHouse embedded analytics?',
        body: (
          <p>
            ClickHouse embedded analytics is analytics your product shows its own customers (dashboards, exports, a
            public API, AI answers) served from ClickHouse and limited to each customer’s data. ClickHouse does the
            aggregation. Something between your app and the database has to own the tenant filter, the metric
            definitions and the query limits, and choosing that layer is most of the design work.
          </p>
        ),
      }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="Why ClickHouse"
        title="Why ClickHouse suits customer-facing analytics"
        intro={
          <>
            <p>
              Customer dashboards ask the same few questions over and over. They want totals, counts and trends for one
              account, grouped by a handful of columns, over a date range. ClickHouse is a column store, so a query that sums{' '}
              <code className={inlineCode}>amount</code> by <code className={inlineCode}>status</code> reads those two
              columns and skips the rest of the row.
            </p>
            <p>
              The bigger win for multi-tenant products is the sorting key. ClickHouse stores each part sorted by{' '}
              <code className={inlineCode}>ORDER BY</code> and keeps a sparse index with one entry per granule (8,192
              rows by default). When a query filters on the first key column, ClickHouse binary-searches that index and
              reads only the granules that can match. Put the tenant column first and a small account’s dashboard reads
              only that account’s granules.
            </p>
          </>
        }
      >
        <CodeWindow code={tableDdl} filename="orders.sql" language="sql" />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <h3 className="text-lg font-medium text-text">Rollups for the charts everyone opens</h3>
          <p>
            The landing dashboard is usually the most-run query in the product. An incremental materialized view runs
            on every insert into the source table and writes pre-aggregated rows into a target table, so the chart
            reads thousands of daily rows instead of millions of orders. A{' '}
            <code className={inlineCode}>SummingMergeTree</code> target sums numeric columns when parts merge. Merges
            happen in the background, so the read query still has to <code className={inlineCode}>sum()</code> and{' '}
            <code className={inlineCode}>GROUP BY</code>.
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={rollupDdl} filename="orders_daily.sql" language="sql" />
        </div>
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            Projections are the other tool. A projection is a hidden copy of the table with a different sort order or
            pre-computed aggregates, kept in sync on insert. At query time ClickHouse picks whichever one reads the
            least data, so callers do not change their SQL. Use one when a second access path, such as filtering by{' '}
            <code className={inlineCode}>country</code> across an account, keeps showing up in slow-query logs.
          </p>
          <p>
            What ClickHouse does not give you is a product layer. It has no idea which customer is signed in, it will
            happily run an unfiltered query for anyone with credentials, and a dashboard that fires twelve small queries
            for each of two hundred concurrent users is a different workload from one analyst scanning a billion rows.
            The rest of this page is about that layer.
          </p>
        </div>
      </HubSection>

      <HubSection
        id="patterns"
        band
        eyebrow="Architecture"
        title="Three ways to put ClickHouse behind a product"
        intro={
          <p>
            Every ClickHouse embedded analytics setup is one of three shapes. They differ mainly in where the tenant
            filter and the metric definitions live, and that decides what breaks as the number of charts grows.
          </p>
        }
      >
        <HubTable
          caption="Direct queries, an API layer and a semantic layer compared for ClickHouse embedded analytics"
          columns={['', 'Direct queries from the app', 'Hand-written API layer', 'Semantic layer']}
          rows={patternRows}
        />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <h3 className="text-lg font-medium text-text">Direct queries</h3>
          <p>
            The backend builds SQL and sends it to ClickHouse. It is the fastest way to ship the first chart and the
            hardest to keep safe: each query carries its own <code className={inlineCode}>WHERE account_id = ?</code>,
            and a review rarely catches a line that is missing.
          </p>
          <h3 className="text-lg font-medium text-text">A hand-written API layer</h3>
          <p>
            Each chart gets an endpoint with validation and a shared helper that adds the tenant filter. This works
            for a fixed set of charts. It gets expensive when product asks for “the same chart, grouped by plan”, and
            the definition of revenue ends up copied into the dashboard endpoint, the CSV export and the public API.
          </p>
          <h3 className="text-lg font-medium text-text">A semantic layer</h3>
          <p>
            Each table is described once as a dataset, with its measures, the dimensions callers may group and filter
            by, its joins and its tenant column. Requests name a measure and dimensions, and the layer writes the SQL and adds
            the tenant filter. New charts are new requests against existing datasets, and agents get tools generated
            from the same definitions. The trade is one more abstraction to learn. For the general concept, see{' '}
            <Link href="/semantic-layer" className={inlineLink}>
              what a semantic layer is
            </Link>
            ; for the vendors that sell it, see{' '}
            <Link href="/embedded-analytics" className={inlineLink}>
              embedded analytics
            </Link>{' '}
            for developers.
          </p>
        </div>
        <div className="mt-10">
          <ArchitectureDiagram />
        </div>
      </HubSection>

      <HubSection
        id="tenant-isolation"
        eyebrow="Multi-tenancy"
        title="Tenant isolation in three layers"
        intro={
          <p>
            One tenant filter in one place is the goal. Two cheaper layers under it catch the mistakes that the
            application layer cannot.
          </p>
        }
      >
        <div className="max-w-[760px] space-y-4 text-body text-text-muted">
          <h3 className="text-lg font-medium text-text">1. Sort by tenant first</h3>
          <p>
            <code className={inlineCode}>ORDER BY (account_id, created_at, ...)</code> is about speed. It makes the
            tenant filter cheap, so nobody is tempted to drop it for performance. Keep the tenant column
            first in the sorting key of every table, rollup and projection a customer query can touch.
          </p>
          <h3 className="text-lg font-medium text-text">2. A dedicated reader user with row policies</h3>
          <p>
            The application should connect as a user that can only read. A row policy adds a condition to every{' '}
            <code className={inlineCode}>SELECT</code> that user runs on the table. Policies are attached to users and
            roles, and they cannot see your application session, so with one shared reader they suit rules that hold
            for every request, such as hiding internal or demo accounts or soft-deleted rows. For a customer who needs hard
            isolation, give that customer its own ClickHouse user and a policy pinned to its account.
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={rowPolicyDdl} filename="access.sql" language="sql" />
        </div>
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            The docs flag one trap. Once a table has row policies, a user with no policy on it sees every row by
            default. Every user that reads customer tables needs a policy, or none of them should.
          </p>
          <h3 className="text-lg font-medium text-text">3. One tenant filter in application code</h3>
          <p>
            The per-request filter belongs in one place that every dashboard, export, API call and agent tool goes
            through. In hypequery that place is the dataset. With <code className={inlineCode}>tenantKey</code> set,
            the layer adds <code className={inlineCode}>WHERE account_id = &apos;…&apos;</code> from trusted runtime
            context, throws if a query arrives without a tenant, and rejects callers who try to filter on the tenant
            column themselves. Admin views use an explicit set of tenants, and a cross-tenant scope exists for internal
            jobs only. The{' '}
            <Link href="/docs/datasets/multi-tenancy" className={inlineLink}>
              multi-tenancy docs
            </Link>{' '}
            cover each mode.
          </p>
          <h3 className="text-lg font-medium text-text">Test isolation with two tenants</h3>
          <p>
            Seed two accounts with different row counts and assert that each sees its own totals and that a query with
            no tenant fails. Run it in CI next to the rest of your tests.
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={tenantTestCode} filename="tenancy.test.ts" />
        </div>
      </HubSection>

      <HubSection
        id="guardrails"
        band
        eyebrow="Cost guardrails"
        title="Query limits, quotas and caching"
        intro={
          <>
            <p>
              A customer-facing ClickHouse cluster fails in two ways. One heavy query eats memory, or a busy dashboard
              sends a flood of light ones. Settings profiles handle the first, quotas and caching the
              second.
            </p>
            <p>
              Picture a dashboard with ten charts that fifty people in one account open within five minutes. Uncached,
              that is five hundred queries. With a sixty-second cache keyed by account, it is at most ten queries a
              minute for that account, however many people are looking.
            </p>
          </>
        }
      >
        <div className="max-w-[760px] space-y-4 text-body text-text-muted">
          <h3 className="text-lg font-medium text-text">A settings profile and a quota for the reader</h3>
          <p>
            Put limits on the user, not in each query. <code className={inlineCode}>max_execution_time</code> stops long
            queries, <code className={inlineCode}>max_rows_to_read</code> and{' '}
            <code className={inlineCode}>max_bytes_to_read</code> stop full scans,{' '}
            <code className={inlineCode}>max_result_rows</code> bounds what comes back, and{' '}
            <code className={inlineCode}>max_memory_usage</code> caps RAM per query. A{' '}
            <code className={inlineCode}>MAX</code> constraint in the profile means a query that tries to{' '}
            <code className={inlineCode}>SET</code> a higher value gets an exception.
          </p>
          <p>
            <code className={inlineCode}>readonly = 2</code> blocks writes and DDL but still lets a client tighten
            settings per query; <code className={inlineCode}>readonly = 1</code> refuses any per-query setting that does
            not match the profile. A quota then caps query counts and rows read per interval, and{' '}
            <code className={inlineCode}>queries_per_normalized_hash</code> stops a single query shape, such as a
            dashboard stuck in a refresh loop, from using the whole budget.
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={profileDdl} filename="limits.sql" language="sql" />
        </div>
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            The numbers above are placeholders; size them from your own <code className={inlineCode}>system.query_log</code>.
            The{' '}
            <Link href="/blog/clickhouse-settings-for-application-backends" className={inlineLink}>
              ClickHouse settings for application backends
            </Link>{' '}
            post goes through the full profile an API user should have.
          </p>
          <h3 className="text-lg font-medium text-text">Limits in the application layer</h3>
          <p>
            ClickHouse limits stop damage after a query starts. Application limits stop the query from being shaped
            badly in the first place. A hypequery dataset can declare{' '}
            <code className={inlineCode}>limits</code>. <code className={inlineCode}>maxDimensions</code> and{' '}
            <code className={inlineCode}>maxFilters</code> bound how wide a request can be, and{' '}
            <code className={inlineCode}>maxResultSize</code> caps the rows one query returns, for library calls and
            HTTP endpoints alike. Each endpoint can also set <code className={inlineCode}>maxLimit</code>; a request
            that asks for more is clamped to it. In Python, the planner attaches{' '}
            <code className={inlineCode}>readonly</code>, <code className={inlineCode}>max_execution_time</code>,{' '}
            <code className={inlineCode}>max_result_rows</code>, <code className={inlineCode}>max_result_bytes</code>{' '}
            and <code className={inlineCode}>max_threads</code> to every query, and the{' '}
            <Link href="/docs/reference/readonly-users" className={inlineLink}>
              read-only users reference
            </Link>{' '}
            explains how that interacts with each <code className={inlineCode}>readonly</code> level.
          </p>
          <h3 className="text-lg font-medium text-text">Cache by meaning, keyed by tenant</h3>
          <p>
            A result cache in front of ClickHouse is only safe if two tenants can never share an entry. The hypequery
            dataset cache keys each entry on everything that can change its rows, including dimensions, measures,
            filters, ordering, pagination, time grain, timezone, the dataset definition and the tenant. Results are served fresh
            for <code className={inlineCode}>ttlMs</code>, then stale for{' '}
            <code className={inlineCode}>staleWhileRevalidateMs</code> while a background refresh runs. Errors are
            never cached, and identical queries in flight at the same moment share one execution, which matters when a
            dashboard loads ten charts at once.
          </p>
          <p>
            The default store is an in-process LRU of 500 entries. With more than one server, plug in a shared store
            such as Redis through the three-method store interface. The{' '}
            <Link href="/docs/datasets/caching" className={inlineLink}>
              caching docs
            </Link>{' '}
            include a Redis example.
          </p>
        </div>
      </HubSection>

      <HubSection
        eyebrow="Serving"
        title="React dashboards and AI agents from the same datasets"
        intro={
          <p>
            Once the datasets exist, each surface is a thin adapter over them. None of them gets its own copy of the
            metric or the tenant rule.
          </p>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          <div className={marketing.card}>
            <h3 className={marketing.cardTitle}>React dashboards</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              <code className={inlineCode}>@hypequery/react</code> gives typed hooks such as{' '}
              <code className={inlineCode}>useDataset</code> and <code className={inlineCode}>useMetric</code>, built on
              TanStack Query. You render with your own chart components, so the dashboard looks like the rest of your
              product. See{' '}
              <Link href="/clickhouse-react" className={inlineLink}>
                ClickHouse with React
              </Link>
              .
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className={marketing.cardTitle}>A customer-facing API</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              The same endpoints serve customers who want numbers in their own tools, with request validation, auth and
              an OpenAPI spec generated from the datasets. Large exports can stream NDJSON or Arrow. See{' '}
              <Link href="/clickhouse-api" className={inlineLink}>
                ClickHouse REST API
              </Link>
              .
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className={marketing.cardTitle}>AI agents</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              <code className={inlineCode}>@hypequery/mcp</code> exposes datasets as MCP tools, and a server over
              tenant-scoped datasets refuses to start without a tenant. For your own agent runtime,{' '}
              <code className={inlineCode}>generateDatasetTools</code> builds OpenAI, AI SDK or MCP tool schemas from
              the catalog, with SQL redacted from results by default. See{' '}
              <Link href="/clickhouse-mcp" className={inlineLink}>
                ClickHouse MCP
              </Link>
              .
            </p>
          </div>
        </div>
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            Agents are where the tenant rule is easiest to lose. An agent with a SQL tool and a reader user can write a
            query without the tenant filter, and nothing stops it. An agent with generated dataset tools can only name
            datasets, measures and dimensions that exist; an invalid field comes back as an error the model can repair,
            and the tenant comes from the server, never from the prompt. Hosted embeddable chat and a Slack integration
            are planned for hypequery cloud and are not available yet; today you build the chat UI yourself.
          </p>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Build or buy"
        title="Build on ClickHouse, or buy an embedded BI tool"
        intro={
          <>
            <p>
              Buying wins when people outside engineering must build and change customer dashboards, when customers
              expect a drag-and-drop editor, or when your data is spread across databases hypequery does not support.
              Most embedded BI platforms connect to ClickHouse, and the{' '}
              <Link href="/compare/embedded-analytics-platforms" className={inlineLink}>
                embedded analytics platforms comparison
              </Link>{' '}
              lists how each one embeds and isolates tenants.
            </p>
            <p>
              Building on a data layer wins when the charts must look and behave like your product, when the same
              numbers also feed a public API or agents, and when ClickHouse is already your analytics store. The{' '}
              <Link href="/compare/build-vs-buy-embedded-analytics" className={inlineLink}>
                build vs buy breakdown
              </Link>{' '}
              puts a cost on each part.
            </p>
          </>
        }
      />

      <HubSection
        id="quickstart"
        eyebrow="Quickstart"
        title="Quickstart: one tenant-scoped dataset on ClickHouse"
        intro={
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Install <code className={inlineCode}>@hypequery/clickhouse</code>,{' '}
              <code className={inlineCode}>@hypequery/datasets</code> and{' '}
              <code className={inlineCode}>@hypequery/serve</code>, and connect as your read-only user.
            </li>
            <li>Describe one table as a dataset with a tenant key, limits and a cache.</li>
            <li>Serve it behind your existing auth, with the tenant taken from the verified session.</li>
            <li>Render it with a React hook, or point an MCP client at it.</li>
          </ol>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <CodeWindow code={datasetCode} filename="analytics/datasets.ts" />
          <CodeWindow code={serveCode} filename="analytics/api.ts" />
        </div>
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            The endpoint requires the <code className={inlineCode}>analytics:read</code> scope, caches results for a
            minute per tenant and clamps page sizes to 100 rows. These rules live in the dataset and API files, so a
            change to any of them shows up in a pull request. The{' '}
            <Link href="/docs/quick-start/api-and-dashboard" className={inlineLink}>
              API and dashboard quickstart
            </Link>{' '}
            walks through the same steps with a running app.
          </p>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Where it fits"
        title="When hypequery is the wrong choice"
        intro={
          <>
            <p>hypequery is infrastructure for engineers, not a dashboard product. It is the wrong choice when:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Your data is in Postgres, BigQuery or Snowflake. hypequery is ClickHouse-only today.</li>
              <li>
                Non-engineers need to build and change customer dashboards in a drag-and-drop editor. Embedded BI tools
                do that.
              </li>
              <li>Customers expect to explore data freely, building their own charts and queries.</li>
              <li>You have no front-end time to build chart components.</li>
            </ul>
          </>
        }
      />

      <HubSection
        eyebrow="Adoption"
        title="Open source and built in public"
        intro={
          <p>
            The hypequery libraries are Apache 2.0 and developed in the open on GitHub. These numbers are fetched from
            npm and GitHub when the page is built:
          </p>
        }
      >
        <dl className="grid max-w-[760px] gap-5 sm:grid-cols-2">
          <div className={marketing.card}>
            <dt className="font-mono text-xs text-text-dim">npm downloads, last 30 days</dt>
            <dd className="mt-2 text-2xl font-medium tracking-tight text-text">
              {monthlyDownloads !== null ? new Intl.NumberFormat('en').format(monthlyDownloads) : (
                <a href="https://www.npmjs.com/org/hypequery" className={inlineLink}>See npm</a>
              )}
            </dd>
            <dd className="mt-1 text-xs text-text-dim">@hypequery/clickhouse and @hypequery/datasets combined</dd>
          </div>
          <div className={marketing.card}>
            <dt className="font-mono text-xs text-text-dim">GitHub stars</dt>
            <dd className="mt-2 text-2xl font-medium tracking-tight text-text">
              {stars !== null ? new Intl.NumberFormat('en').format(stars) : (
                <a href="https://github.com/hypequery/hypequery" className={inlineLink}>See GitHub</a>
              )}
            </dd>
            <dd className="mt-1 text-xs text-text-dim">
              <a href="https://github.com/hypequery/hypequery" className="hover:text-accent">
                github.com/hypequery/hypequery
              </a>
            </dd>
          </div>
        </dl>
      </HubSection>

      <HubSection band eyebrow="Questions" title="ClickHouse embedded analytics FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection eyebrow="Keep reading" title="Guides, docs and comparisons">
        <HubLinkGrid links={nextLinks} />
      </HubSection>

      <section className={`${marketing.container} pb-14`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
              Put one customer-facing metric behind a tenant key
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Define one dataset over a table you already have, serve it, and render it with a hook. Want it hosted
              instead? hypequery cloud is in early access:{' '}
              <DeployWaitlist location="saas-analytics-next-step" className={inlineLink} />
            </p>
          </div>
          <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
            <Link
              href="/docs/quick-start"
              data-umami-event="cta_click"
              data-umami-event-target="docs_quick_start"
              data-umami-event-location="hub_next_step_primary"
              className={marketing.primaryButton}
            >
              Get started <span aria-hidden="true">→</span>
            </Link>
            <Link href="/docs/datasets/multi-tenancy" className={marketing.secondaryButton}>
              Multi-tenancy docs
            </Link>
          </div>
        </div>
      </section>

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
