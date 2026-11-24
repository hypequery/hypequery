import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, HubSources, HubTable, type HubLink } from '@/components/hub-page';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

// Buyer page: the reference architecture for customer-facing analytics in a
// TypeScript SaaS that already runs on Postgres. /clickhouse-saas-analytics is
// the deep dive on tenant isolation and guardrails; /postgres-analytics is the
// "is Postgres still enough?" step before this one.
const PATH = '/saas-analytics-backend';
const TITLE = 'Build a SaaS Analytics Backend in TypeScript';
const DESCRIPTION =
  'How to build customer-facing analytics in a TypeScript SaaS with Postgres, ClickHouse, typed datasets, a tenant-scoped API and React hooks.';
const PUBLISHED = '2026-11-24';
const UPDATED = updatedFor(PATH);
const VERIFIED_ON = 'November 24, 2026';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: TITLE,
    description: DESCRIPTION,
    images: ogImage('SaaS analytics backend in TypeScript'),
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

// Insert builder: db.insert(table).values(rows).execute(), as documented in
// /blog/add-clickhouse-analytics-nodejs-backend.
const ingestCode = `import { db } from './client'; // createQueryBuilder({ url, username, password, database })

type UsageEvent = {
  tenant_id: number;
  user_id: number;
  event_type: string;
  occurred_at: string;
};

const buffer: UsageEvent[] = [];

export function track(event: UsageEvent) {
  buffer.push(event);
}

// One insert per second instead of one per event: each INSERT creates a part
setInterval(async () => {
  if (buffer.length === 0) return;
  const rows = buffer.splice(0, buffer.length);
  await db.insert('events').values(rows).execute();
}, 1_000);`;

// Same dataset API as the postgres-app-clickhouse-analytics example, plus a
// tenantKey as in /clickhouse-saas-analytics (type-checked there).
const datasetCode = `import { createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';
import { db } from './client';

export const Usage = dataset('usage', {
  source: 'events',
  tenantKey: 'tenant_id', // every query is filtered to one customer
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    userId: dimension.number({ column: 'user_id' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
    activeUsers: measure.countDistinct('userId', { label: 'Active users' }),
    lastSeenAt: measure.max('occurredAt', { label: 'Last event' }),
  },
  limits: { maxDimensions: 3, maxFilters: 10, maxResultSize: 1_000 },
});

export const analytics = createDatasetClient({
  queryBuilder: db,
  cache: { ttlMs: 60_000, staleWhileRevalidateMs: 300_000 },
});`;

// initServe / serve options as on /clickhouse-saas-analytics.
const serveCode = `import { initServe } from '@hypequery/serve';
import { db } from './client';
import { Usage } from './datasets';
import { verifySession } from './auth'; // your existing JWT or session check

const { serve } = initServe({
  // The tenant comes from the signed-in session, never from the request body
  auth: async ({ request }) => verifySession(request.headers.authorization),
  tenant: { extract: (auth) => auth?.tenantId, required: true },
});

export const api = serve({
  queryBuilder: db,
  datasets: {
    usage: {
      dataset: Usage,
      requiredScopes: ['analytics:read'],
      cache: 60_000,
      maxLimit: 100,
    },
  },
});`;

const reactCode = `// The hook posts to /api/analytics/datasets/usage/query
const { data, isLoading } = useDataset('usage', {
  by: 'day',
  measures: ['activeUsers'],
});

return <ActiveUsersChart rows={data?.data ?? []} loading={isLoading} />;`;

// From examples/postgres-app-clickhouse-analytics/src/accounts.ts, trimmed.
const joinCode = `const rows = await pgdb
  .select()
  .from(accounts)
  .where(eq(accounts.plan, plan));

const usage = await analytics.execute(Usage, {
  dimensions: ['tenantId'],
  measures: ['events', 'activeUsers'],
  filters: [inList('tenantId', rows.map((a) => a.id)), gte('occurredAt', since)],
  limit: rows.length,
});

const byId = new Map(usage.data.map((u) => [Number(u.tenantId), u]));

return rows.map((account) => ({
  ...account,
  activeUsers: Number(byId.get(account.id)?.activeUsers ?? 0),
}));`;

const layerRows = [
  ['App database', 'Accounts, plans, seats, settings: everything users edit', 'Postgres, with Drizzle, Prisma or your ORM'],
  ['Analytics store', 'Events, usage and anything you aggregate over time', 'ClickHouse (Cloud, self-hosted or chDB)'],
  ['Ingestion', 'Events in batches; Postgres tables by CDC when analytics need them', 'Batched inserts; PeerDB, ClickPipes or Debezium'],
  ['Metric model', 'Measures, dimensions and the tenant column, defined once in code', 'hypequery datasets'],
  ['API', 'Auth, tenant scoping, validation, caching, limits', 'hypequery serve, inside your existing backend'],
  ['Frontend', 'Charts that look like the rest of your product', 'React hooks and your own chart components'],
  ['Agents', 'The same metrics as tools, scoped to one tenant', 'hypequery MCP'],
];

const placementRows = [
  ['Accounts, users, plans, seats', 'Postgres', 'Users edit them and expect to read the change back at once'],
  ['Product events, API calls, page views', 'ClickHouse only', 'Append-only, high volume, only ever aggregated'],
  ['Orders, subscriptions, invoices', 'Postgres, copied to ClickHouse by CDC', 'Transactions in Postgres, trends and breakdowns in ClickHouse'],
  ['Small lookup tables (plans, regions)', 'Postgres, read by ClickHouse in place', 'A PostgreSQL table engine or a periodic copy is enough'],
];

const checklistRows = [
  ['Read-only ClickHouse user with a settings profile', 'Caps time, rows read and memory per query, so one dashboard cannot take the cluster down'],
  ['Tenant isolation test in CI', 'Seed two tenants with different counts and assert each sees only its own'],
  ['Cache keyed by tenant', 'Without it, ten charts opened by fifty people send five hundred queries; with a 60-second cache, at most ten a minute'],
  ['FINAL on replicated tables', 'CDC writes updates as new versions; without FINAL, counts drift up between merges'],
  ['Data age on screen', 'CDC is seconds behind and batch pulls minutes or hours; say so where users act on numbers'],
  ['Batched inserts', 'Thousands of rows per insert, or async inserts; one insert per event creates too many parts'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What database should a SaaS app use for analytics?',
    answer:
      'Keep Postgres for the app’s own data and add a column store for the analytics once queries aggregate large tables. ClickHouse is the common choice for customer-facing analytics because it answers aggregations over millions of rows in tens of milliseconds and handles many concurrent queries. Until then, analytics can stay in Postgres with indexes, rollups or a read replica.',
  },
  {
    question: 'Can I build customer-facing analytics on Postgres alone?',
    answer:
      'Yes, while dashboards look up one customer’s recent data through an index or read precomputed rollups. It gets hard when customers want flexible date ranges and breakdowns over large event tables. Each of those queries scans most of the table, and in our benchmark they took 0.7 to 1.7 seconds on one million events in Postgres against 19 to 61 ms in ClickHouse.',
  },
  {
    question: 'How do I keep each customer’s analytics separate?',
    answer:
      'Take the tenant from the verified session on the server, never from the request, and add the filter in one place every query passes through. In hypequery that is the dataset’s tenantKey, and queries without a tenant throw before they reach ClickHouse. Put the tenant column first in the ClickHouse sorting key so the filter is also fast, and test it with two seeded tenants.',
  },
  {
    question: 'Do I need Kafka to get data into ClickHouse?',
    answer:
      'No. Product events can be inserted straight into ClickHouse in batches from your backend. Postgres tables can be replicated with PeerDB or ClickPipes, which read the Postgres write-ahead log without Kafka. Debezium is the option that usually comes with Kafka.',
  },
  {
    question: 'Should I build this or buy an embedded analytics tool?',
    answer:
      'Buy when people outside engineering must build and edit customer dashboards, or customers expect a drag-and-drop editor. Build when the charts must look and behave like your product, when the same numbers feed a public API or AI agents, and when engineers own the dashboards.',
  },
  {
    question: 'Is hypequery only for TypeScript?',
    answer:
      'No. The TypeScript libraries cover the query builder, datasets, the API layer, React hooks and MCP. There is also a Python SDK for datasets and FastAPI backends. Both are Apache 2.0 and work with ClickHouse.',
  },
];

const nextLinks: HubLink[] = [
  {
    href: '/postgres-analytics',
    title: 'Postgres analytics getting slow?',
    description: 'The fixes to try before adding a second database, cheapest first.',
  },
  {
    href: '/clickhouse-saas-analytics',
    title: 'ClickHouse embedded analytics for SaaS',
    description: 'Tenant isolation, row policies, quotas and caching in depth.',
  },
  {
    href: '/guides/clickhouse-vs-postgres-app-analytics',
    title: 'ClickHouse vs Postgres for app analytics',
    description: 'Benchmarks on one million events, and every way to move data across.',
  },
  {
    href: '/examples/postgres-app-clickhouse-analytics',
    title: 'Postgres + Drizzle app with ClickHouse analytics',
    description: 'The join-by-id pattern from this page as a runnable app.',
  },
  {
    href: '/examples/multi-tenant-embedded-analytics',
    title: 'Multi-tenant embedded analytics example',
    description: 'A tenant-scoped dataset served with signed tokens.',
  },
  {
    href: '/clickhouse-react',
    title: 'ClickHouse with React',
    description: 'Typed hooks over hypequery endpoints, with your own charts.',
  },
];

const sources = [
  {
    vendor: 'ClickHouse docs',
    urls: [
      'https://clickhouse.com/docs/optimize/asynchronous-inserts',
      'https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes',
      'https://clickhouse.com/docs/engines/table-engines/mergetree-family/replacingmergetree',
      'https://clickhouse.com/docs/integrations/clickpipes/postgres',
    ],
  },
  {
    vendor: 'Replication tools',
    urls: ['https://github.com/PeerDB-io/peerdb', 'https://debezium.io/documentation/reference/stable/connectors/postgresql.html'],
  },
];

/** The reference architecture as crawlable HTML. */
function ArchitectureDiagram() {
  const box = 'rounded-lg border border-border-strong bg-bg-card px-4 py-3 text-sm';
  const arrow = 'select-none text-center font-mono text-text-dim';
  return (
    <figure className="rounded-xl border border-border bg-bg-alt/40 p-5 sm:p-8">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={box}>
          <p className="font-medium text-text">Postgres</p>
          <p className="mt-1 text-text-muted">Accounts, plans, orders: the app’s system of record, through your ORM.</p>
        </div>
        <div className={box}>
          <p className="font-medium text-text">Your backend</p>
          <p className="mt-1 text-text-muted">Writes app data to Postgres and batches product events into ClickHouse.</p>
        </div>
      </div>
      <p aria-hidden="true" className={`${arrow} my-3`}>
        ↓ CDC for tables analytics needs · batched inserts for events ↓
      </p>
      <div className={box}>
        <p className="font-medium text-text">ClickHouse</p>
        <p className="mt-1 text-text-muted">Events and replicated tables, sorted by tenant, read by a read-only user.</p>
      </div>
      <p aria-hidden="true" className={`${arrow} my-3`}>
        ↓
      </p>
      <div className={`${box} border-accent/60`}>
        <p className="font-medium text-text">hypequery datasets and API, in your repo</p>
        <p className="mt-1 text-text-muted">
          Metrics defined once in TypeScript. Tenant taken from the session. Limits and a cache per endpoint.
        </p>
      </div>
      <p aria-hidden="true" className={`${arrow} my-3`}>
        ↓ the same definitions serve ↓
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={box}>
          <p className="font-medium text-text">In-app dashboards</p>
          <p className="mt-1 text-text-muted">React hooks and your own chart components.</p>
        </div>
        <div className={box}>
          <p className="font-medium text-text">Customer API</p>
          <p className="mt-1 text-text-muted">Validated endpoints with an OpenAPI spec.</p>
        </div>
        <div className={box}>
          <p className="font-medium text-text">AI agents</p>
          <p className="mt-1 text-text-muted">MCP tools scoped to one tenant.</p>
        </div>
      </div>
      <figcaption className="mt-5 text-xs leading-5 text-text-dim">
        Postgres keeps the transactions. ClickHouse answers the aggregations. One typed layer owns the metrics and the
        tenant rule for every surface.
      </figcaption>
    </figure>
  );
}

export default function SaasAnalyticsBackendPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'SaaS analytics backend' }]}
      eyebrow="SaaS analytics backend"
      title="How to build an analytics backend for a SaaS app in TypeScript"
      updated={UPDATED}
      lead={
        <p>
          Your customers want dashboards, usage numbers and an API inside your product, and your app runs on
          Postgres. This is the architecture most TypeScript teams end up with, layer by layer. It covers what stays in Postgres, what goes to ClickHouse, how data gets there, and how one typed layer serves dashboards, the API and
          agents without leaking one customer’s data to another.
        </p>
      }
      primaryCta={{ href: '#architecture', label: 'See the architecture', target: 'saas_backend_architecture' }}
      secondaryCta={{ href: '#build', label: 'Jump to the code', target: 'saas_backend_code' }}
      definition={{
        term: 'What is a SaaS analytics backend?',
        body: (
          <p>
            A SaaS analytics backend is the part of your stack that answers your customers’ analytics questions inside the product, such as dashboards, usage pages, exports, a public API and AI answers. It needs a store that aggregates
            quickly, a single definition of each metric, and a tenant filter that every request goes through. For most
            TypeScript SaaS teams that means Postgres for the app, ClickHouse for analytics, and a typed layer between
            them.
          </p>
        ),
      }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        id="architecture"
        eyebrow="Architecture"
        title="The reference architecture"
        intro={
          <p>
            Seven layers, each with one job. You may already have the first two. The rest is what turns raw events into
            numbers a customer can see.
          </p>
        }
      >
        <HubTable
          caption="Layers of a TypeScript SaaS analytics backend and the tools for each"
          columns={['Layer', 'Its job', 'Typical choice']}
          rows={layerRows}
        />
        <div className="mt-10">
          <ArchitectureDiagram />
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Before you start"
        title="Do you need a second database yet?"
        intro={
          <>
            <p>
              Not always. If your dashboards look up one customer’s recent data through an index, Postgres with good
              indexes, rollup tables or a read replica will carry you a long way. The{' '}
              <Link href="/postgres-analytics" className={inlineLink}>
                slow Postgres analytics guide
              </Link>{' '}
              goes through those fixes in order.
            </p>
            <p>
              You need a second database when the queries aggregate most of a large table. On one million
              events, daily totals, distinct users and p95 latency took 0.7 to 1.7 seconds in Postgres 17 and 19 to 61
              ms in ClickHouse in{' '}
              <Link href="/guides/clickhouse-vs-postgres-app-analytics" className={inlineLink}>
                our benchmark
              </Link>
              . Most products that log events pass a million rows quickly.
            </p>
          </>
        }
      />

      <HubSection
        id="build"
        eyebrow="Step 1"
        title="Decide what lives where"
        intro={
          <p>
            One rule keeps this simple. Data users edit stays in Postgres, and data you only ever add to and
            aggregate goes to ClickHouse.
          </p>
        }
      >
        <HubTable
          caption="Which SaaS data belongs in Postgres and which in ClickHouse"
          columns={['Data', 'Where', 'Why']}
          rows={placementRows}
        />
      </HubSection>

      <HubSection
        band
        eyebrow="Step 2"
        title="Get the data into ClickHouse"
        intro={
          <p>
            Events go straight from your backend to ClickHouse, never through Postgres. Batch them: every insert
            creates a new part on disk, and ClickHouse prefers thousands of rows per insert to one row at a time.
            Server-side async inserts do the batching for you if you cannot batch in the app.
          </p>
        }
      >
        <CodeWindow code={ingestCode} filename="analytics/track.ts" />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            In production, flush on shutdown too and retry failed batches, or put a queue in front. For tables that
            already live in Postgres, such as orders or subscriptions, use CDC. It reads the Postgres write-ahead log
            and lands each change in a <code className={inlineCode}>ReplacingMergeTree</code> ordered by the primary key.
            PeerDB and ClickPipes, the managed version in ClickHouse Cloud, do this without Kafka; Debezium usually runs
            with it. The{' '}
            <Link href="/guides/clickhouse-vs-postgres-app-analytics" className={inlineLink}>
              ClickHouse vs Postgres guide
            </Link>{' '}
            compares CDC, dual writes and batch pulls, and shows the table CDC writes into.
          </p>
        </div>
      </HubSection>

      <HubSection
        eyebrow="Step 3"
        title="Define each metric once"
        intro={
          <p>
            “Active users” should mean the same thing on the dashboard, in the CSV export and in the API. Describe the
            table once as a dataset, with its measures, the dimensions callers may group and filter by, and the column that
            identifies the customer.
          </p>
        }
      >
        <CodeWindow code={datasetCode} filename="analytics/datasets.ts" />
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            <code className={inlineCode}>tenantKey</code> is the important line. With it set, every query gets{' '}
            <code className={inlineCode}>WHERE tenant_id = …</code> from trusted runtime context, and a query that
            arrives without a tenant throws before it reaches ClickHouse. <code className={inlineCode}>limits</code>{' '}
            bounds how wide one request can be, and the cache serves repeated requests for a minute per tenant.
          </p>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Step 4"
        title="Serve it behind your existing auth"
        intro={
          <p>
            The API layer runs inside the backend you already have. It reads the tenant from the verified session,
            checks scopes, applies the cache and clamps page sizes.
          </p>
        }
      >
        <CodeWindow code={serveCode} filename="analytics/api.ts" />
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            The same datasets can be exposed as an OpenAPI-described REST API for customers who want numbers in their
            own tools, and as MCP tools for AI agents. The tenant rule comes along each time, because it lives in the
            dataset and not in each endpoint. The{' '}
            <Link href="/clickhouse-saas-analytics" className={inlineLink}>
              ClickHouse embedded analytics guide
            </Link>{' '}
            covers row policies, quotas and settings profiles for the ClickHouse side.
          </p>
        </div>
      </HubSection>

      <HubSection
        eyebrow="Step 5"
        title="Render it in React"
        intro={
          <p>
            <code className={inlineCode}>@hypequery/react</code> gives typed hooks, built on TanStack Query, over the
            endpoints above. You draw the chart with whatever components the rest of your product uses.
          </p>
        }
      >
        <CodeWindow code={reactCode} filename="ActiveUsers.tsx" />
      </HubSection>

      <HubSection
        band
        eyebrow="Two databases"
        title="Joining Postgres and ClickHouse data"
        intro={
          <p>
            Some screens need both, such as seats from Postgres next to active users from ClickHouse. Fetch each by id and merge them
            in the app. That is two queries and no cross-database SQL, and it works whenever Postgres decides which rows
            are on the screen, such as a page of accounts.
          </p>
        }
      >
        <CodeWindow code={joinCode} filename="accounts.ts" />
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            This is trimmed from the{' '}
            <Link href="/examples/postgres-app-clickhouse-analytics" className={inlineLink}>
              Postgres + Drizzle example
            </Link>
            , which runs with one command. On its million seed events, the per-account rollup took about 1.7 seconds in
            Postgres 17 and 30 to 50 ms in ClickHouse. When you need to filter or sort by Postgres columns across every
            account, replicate that table into ClickHouse instead and join it there.
          </p>
        </div>
      </HubSection>

      <HubSection
        eyebrow="Production"
        title="Before customers see it"
        intro={<p>The list we would check before turning dashboards on for every account.</p>}
      >
        <HubTable caption="Production checklist for a SaaS analytics backend" columns={['Check', 'Why']} rows={checklistRows} />
      </HubSection>

      <HubSection
        band
        eyebrow="Where it fits"
        title="When to build something else"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Your analytics are small and per customer. Stay on Postgres, and come back when the{' '}
              <Link href="/postgres-analytics" className={inlineLink}>
                fixes inside Postgres
              </Link>{' '}
              run out.
            </li>
            <li>
              Non-engineers need to build customer dashboards in an editor. An embedded BI tool fits better, as the{' '}
              <Link href="/compare/build-vs-buy-embedded-analytics" className={inlineLink}>
                build vs buy embedded analytics
              </Link>{' '}
              comparison explains.
            </li>
            <li>
              Your analytics live in BigQuery or Snowflake and will stay there. hypequery works with ClickHouse only.
            </li>
          </ul>
        }
      />

      <HubSection eyebrow="Questions" title="SaaS analytics backend FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection band eyebrow="Keep reading" title="Guides and examples">
        <HubLinkGrid links={nextLinks} />
      </HubSection>

      <section className={`${marketing.container} pb-14`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
              Put one customer metric behind a tenant key
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Define one dataset over a ClickHouse table, serve it from your backend and render it with a hook. Want it
              hosted instead? hypequery cloud is in early access.{' '}
              <DeployWaitlist location="saas-analytics-backend-next-step" className={inlineLink} />
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
            <Link href="/examples/postgres-app-clickhouse-analytics" className={marketing.secondaryButton}>
              Postgres + ClickHouse example
            </Link>
          </div>
        </div>
      </section>

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
