import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, HubSources, HubTable, type HubLink } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

// Buyer page for teams whose Postgres analytics queries are getting slow. It
// walks the fixes in the order a team should try them, and hands off to the
// ClickHouse vs Postgres guide (benchmarks) and /saas-analytics-backend
// (architecture) instead of repeating them.
const PATH = '/postgres-analytics';
const TITLE = 'Slow Postgres Analytics Queries: What to Do Next';
const DESCRIPTION =
  'Postgres analytics queries getting slow? Find the cause, tune and index, add rollups or a replica, try pg_duckdb or pg_clickhouse, then move to ClickHouse.';
const PUBLISHED = '2026-11-24';
const UPDATED = updatedFor(PATH);
// Postgres behaviour was checked against postgresql.org/docs/current, and
// extension status against each project's GitHub page and the ClickHouse
// extension survey listed in Sources, on this date.
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
    images: ogImage('Slow Postgres analytics queries'),
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

// pg_stat_statements column names as of Postgres 13 (total_exec_time, mean_exec_time).
const slowQueriesSql = `-- Needs shared_preload_libraries = 'pg_stat_statements'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT
  round(total_exec_time) AS total_ms,
  calls,
  round(mean_exec_time) AS mean_ms,
  left(query, 120) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;`;

const explainSql = `EXPLAIN (ANALYZE, BUFFERS)
SELECT event_type,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
FROM events
WHERE occurred_at >= now() - interval '90 days'
GROUP BY event_type;

-- Look for:
--   Seq Scan on events ... rows=<most of the table>
--   Sort Method: external merge  Disk: ...kB
--   Buffers: shared read=<large>  (pages read from disk, not cache)`;

const tuningSql = `-- Fresh statistics first: the planner picks scans from these
ANALYZE events;

-- Range queries over an append-only, time-ordered table
CREATE INDEX events_occurred_brin ON events USING brin (occurred_at);

-- Per-customer dashboards: tenant first, then time
CREATE INDEX events_tenant_time ON events (tenant_id, occurred_at);

-- More memory and parallelism for the reporting role only,
-- so transactional connections keep the defaults
ALTER ROLE reporting SET work_mem = '64MB';
ALTER ROLE reporting SET max_parallel_workers_per_gather = 4;
ALTER ROLE reporting SET statement_timeout = '15s';`;

const rollupSql = `CREATE MATERIALIZED VIEW events_daily AS
SELECT tenant_id,
       date_trunc('day', occurred_at) AS day,
       event_type,
       count(*) AS events,
       count(DISTINCT user_id) AS active_users
FROM events
GROUP BY 1, 2, 3;

-- CONCURRENTLY keeps the view readable during a refresh,
-- and needs a unique index that covers every row
CREATE UNIQUE INDEX ON events_daily (tenant_id, day, event_type);

REFRESH MATERIALIZED VIEW CONCURRENTLY events_daily;`;

const ladderRows = [
  [
    '1. Find the slow queries',
    'pg_stat_statements, EXPLAIN (ANALYZE, BUFFERS)',
    'It always applies, so start here',
    'An hour',
  ],
  [
    '2. Statistics, indexes, settings',
    'ANALYZE, B-tree and BRIN indexes, work_mem and parallel workers for a reporting role',
    'Queries aggregate most of the table, so no index helps',
    'A day',
  ],
  [
    '3. Rollups and materialized views',
    'Summary tables refreshed on a schedule',
    'Customers want any date range and any breakdown',
    'Days, plus refresh jobs to own',
  ],
  [
    '4. Partitioning',
    'Monthly partitions on the event table',
    'Queries span every partition anyway',
    'Days, and a migration',
  ],
  [
    '5. A read replica for analytics',
    'Analytics traffic moves off the primary',
    'The queries themselves are too slow, wherever they run',
    'A replica to pay for',
  ],
  [
    '6. An analytics extension',
    'pg_duckdb, TimescaleDB, Citus columnar, pg_clickhouse',
    'Depends on the extension (see the table below)',
    'Varies',
  ],
  [
    '7. A separate analytics database',
    'Copy the analytical tables into ClickHouse with CDC',
    'Rarely, for app analytics',
    'A second database and a pipeline',
  ],
];

const extensionRows = [
  [
    'pg_duckdb',
    'DuckDB’s vectorised engine inside each Postgres connection that uses it',
    'On the Postgres server, with its own memory per connection',
    'Faster aggregates over existing tables when the server has spare CPU and RAM',
  ],
  [
    'TimescaleDB (Hypercore)',
    'Compressed columnstore and continuous aggregates for hypertables',
    'Postgres',
    'Time-partitioned data you can convert to hypertables; the columnstore is under the Timescale License, not Apache 2.0',
  ],
  [
    'Citus columnar',
    'Column-oriented table storage',
    'Postgres',
    'Large append-only tables: columnar tables have no UPDATE or DELETE',
  ],
  [
    'pg_clickhouse',
    'A foreign data wrapper that pushes filters, aggregates, joins and sorts down to ClickHouse',
    'On a separate ClickHouse server',
    'Keeping SQL in Postgres while the heavy work runs elsewhere; data reaches ClickHouse by CDC',
  ],
  [
    'pg_mooncake, pg_analytics',
    'Columnstore projects',
    '',
    'Avoid for new work. pg_mooncake has had no release since February 2025 and ParadeDB discontinued pg_analytics',
  ],
];

const symptomRows = [
  ['One customer’s dashboard is slow', 'An index that starts with the tenant column, then the time column'],
  ['Every dashboard is slow, in the same few shapes', 'A rollup table or materialized view for those shapes'],
  ['Reports slow down the app for everyone', 'A read replica, or a separate role with a statement timeout'],
  ['count(DISTINCT), percentiles or window functions dominate the slow log', 'An analytics extension or ClickHouse'],
  ['Customers ask for any range and any breakdown', 'ClickHouse: precomputing every combination does not scale'],
  ['The events table is larger than the rest of the database', 'Move events to ClickHouse and keep Postgres for app data'],
];

const faqItems: FaqItem[] = [
  {
    question: 'Is Postgres good for analytics?',
    answer:
      'For lookups and small ranges an index can answer, yes, and it stays good for a long time. It slows down on aggregations over most of a large table, such as daily totals for a year, distinct users or percentiles, because it reads whole rows and has to scan every one. On one million events, those queries took 0.7 to 1.7 seconds in Postgres 17 and 19 to 61 ms in ClickHouse in our benchmark.',
  },
  {
    question: 'Why is COUNT(*) slow in Postgres?',
    answer:
      'Postgres keeps old and new versions of rows side by side (MVCC), so it has to check that each row is visible to your transaction. It cannot read a stored total. An index-only scan avoids reading the table only for pages the visibility map marks all-visible, which depends on vacuum keeping up. For dashboards, keep counts in a rollup table, or use an estimate from pg_class.reltuples when an exact number is not needed.',
  },
  {
    question: 'Should I run analytics on a read replica?',
    answer:
      'A replica stops reports from slowing down transactions. It does not make the reports faster, and long queries on a hot standby can be cancelled with "canceling statement due to conflict with recovery" when the primary removes rows the query still needs. hot_standby_feedback and max_standby_streaming_delay trade those cancellations against bloat or replica lag on the primary.',
  },
  {
    question: 'Why is REFRESH MATERIALIZED VIEW slow?',
    answer:
      'Core Postgres recomputes the whole view on every refresh, because it has no incremental refresh. REFRESH ... CONCURRENTLY keeps the view readable while it runs, but needs a unique index and is usually slower than a plain refresh. Once the base table is large, the refresh costs as much as the slow query it replaced. The pg_ivm extension adds incremental views, or move the rollup to ClickHouse, where materialized views update on every insert.',
  },
  {
    question: 'Does pg_duckdb replace ClickHouse?',
    answer:
      'Not for a growing customer-facing workload. pg_duckdb speeds up aggregations, but it runs on the Postgres server and uses its CPU and memory, so heavy analytics still compete with your transactions. It suits occasional analysis on a server with headroom. ClickHouse runs on its own servers and is built for many concurrent analytical queries.',
  },
  {
    question: 'When should I move analytics from Postgres to ClickHouse?',
    answer:
      'When the slow queries aggregate most of a table that grows by millions of rows a month, when customers need flexible breakdowns that rollups cannot cover, or when the events table outgrows everything else. Keep Postgres for the app’s transactional data and copy the analytical tables to ClickHouse, usually with CDC.',
  },
];

const nextLinks: HubLink[] = [
  {
    href: '/postgres-to-clickhouse',
    title: 'Postgres to ClickHouse: every replication option',
    description: 'ClickPipes, PeerDB, Debezium and managed CDC compared, and how to query the copy.',
  },
  {
    href: '/guides/clickhouse-vs-postgres-app-analytics',
    title: 'ClickHouse vs Postgres for app analytics',
    description: 'The benchmark behind the numbers on this page, and every way to move data across.',
  },
  {
    href: '/saas-analytics-backend',
    title: 'Build a SaaS analytics backend in TypeScript',
    description: 'Postgres for the app, ClickHouse for analytics, and a typed API between them.',
  },
  {
    href: '/examples/postgres-app-clickhouse-analytics',
    title: 'Postgres + Drizzle app with ClickHouse analytics',
    description: 'A runnable example that joins Postgres accounts to ClickHouse usage by id.',
  },
  {
    href: '/blog/postgres-mysql-to-clickhouse-sql-equivalents',
    title: 'Postgres to ClickHouse SQL equivalents',
    description: 'What each common Postgres query looks like once the table moves.',
  },
  {
    href: '/clickhouse-saas-analytics',
    title: 'ClickHouse embedded analytics for SaaS',
    description: 'Tenant isolation, query limits and caching for customer-facing dashboards.',
  },
  {
    href: '/blog/clickhouse-schema-design-for-application-developers',
    title: 'ClickHouse schema design for app developers',
    description: 'ORDER BY, LowCardinality and partitions, for people coming from Postgres.',
  },
];

const sources = [
  {
    vendor: 'PostgreSQL docs',
    urls: [
      'https://www.postgresql.org/docs/current/pgstatstatements.html',
      'https://www.postgresql.org/docs/current/using-explain.html',
      'https://www.postgresql.org/docs/current/brin.html',
      'https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html',
      'https://www.postgresql.org/docs/current/ddl-partitioning.html',
      'https://www.postgresql.org/docs/current/hot-standby.html',
      'https://www.postgresql.org/docs/current/indexes-index-only-scans.html',
    ],
  },
  {
    vendor: 'Extensions',
    urls: [
      'https://github.com/duckdb/pg_duckdb',
      'https://github.com/ClickHouse/pg_clickhouse',
      'https://clickhouse.com/resources/engineering/best-postgres-extensions-for-analytics-2026',
      'https://github.com/sraoss/pg_ivm',
    ],
  },
];

export default function PostgresAnalyticsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Postgres analytics' }]}
      eyebrow="Postgres analytics"
      title="Postgres analytics getting slow? What to try, in order"
      updated={UPDATED}
      lead={
        <p>
          Your app runs on Postgres and the dashboards that were instant last year now take seconds. Some fixes take
          an afternoon and buy a year. Others mean a second database. This page goes through them cheapest first,
          with the point where each one stops helping, so you only move to the next step when you need to.
        </p>
      }
      primaryCta={{ href: '#ladder', label: 'See the fixes in order', target: 'pg_analytics_ladder' }}
      secondaryCta={{ href: '#symptoms', label: 'Match your symptom', target: 'pg_analytics_symptoms' }}
      definition={{
        term: 'When does Postgres stop being enough for analytics?',
        body: (
          <p>
            Postgres handles analytics well while queries look up one customer or a short time range through an index.
            It slows down when a query has to aggregate most of a large table, such as totals per day for a year, distinct users or percentiles. It reads every full row to do that, so the time grows with the table. Tuning and
            rollups delay that point; a column store such as ClickHouse removes it.
          </p>
        ),
      }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="Step 1"
        title="Find out which queries are slow, and why"
        intro={
          <p>
            Before changing anything, find the handful of queries that use most of the time.{' '}
            <code className={inlineCode}>pg_stat_statements</code> records every statement’s total and average time, so sort by total. A 200 ms query that runs ten thousand times a day matters more than one 20-second report.
          </p>
        }
      >
        <CodeWindow code={slowQueriesSql} filename="slow-queries.sql" language="sql" />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            Then run the worst one with <code className={inlineCode}>EXPLAIN (ANALYZE, BUFFERS)</code>. The plan shows which kind of slow you have, and that decides which fix below applies.
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={explainSql} filename="explain.sql" language="sql" />
        </div>
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            An index scan that returns a few hundred rows slowly usually means stale statistics or a missing column in
            the index. A sequential scan over most of the table, with a sort that spills to disk, means the query
            really does need every row. Indexes will not save that one; rollups, a replica or a column store will.
          </p>
        </div>
      </HubSection>

      <HubSection
        id="ladder"
        band
        eyebrow="The fixes"
        title="Seven fixes, cheapest first"
        intro={
          <p>
            Each step costs more than the one before. Stop at the first one that brings your slowest dashboard under
            budget at the row count you expect in a year.
          </p>
        }
      >
        <HubTable
          caption="Fixes for slow Postgres analytics, in the order to try them"
          columns={['Step', 'What it is', 'Stops helping when', 'Cost']}
          rows={ladderRows}
        />
      </HubSection>

      <HubSection
        eyebrow="Steps 2 to 4"
        title="Tune Postgres, then precompute"
        intro={
          <p>
            Start with statistics and indexes. Give analytics more memory only on the role that runs reports, so the
            app’s own connections keep the defaults.
          </p>
        }
      >
        <CodeWindow code={tuningSql} filename="tuning.sql" language="sql" />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            A BRIN index stores the minimum and maximum value for each block range, so it stays tiny on an event table
            where new rows always have later timestamps. A B-tree on <code className={inlineCode}>(tenant_id,
            occurred_at)</code> is what makes one customer’s dashboard fast. Raising{' '}
            <code className={inlineCode}>work_mem</code> keeps sorts and hash aggregates in memory. In{' '}
            <Link href="/guides/clickhouse-vs-postgres-app-analytics" className={inlineLink}>
              our benchmark
            </Link>
            , going from 4 MB to 64 MB took an exact p95 over one million events from 1.2 to 1.5 seconds down to 0.75 to
            1.15. Better, and still far from interactive.
          </p>
          <h3 className="text-lg font-medium text-text">Rollups and materialized views</h3>
          <p>
            When dashboards ask the same few questions, compute the answers ahead of time. A materialized view stores
            the result of a query and you refresh it on a schedule, for example with pg_cron.
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={rollupSql} filename="events_daily.sql" language="sql" />
        </div>
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            Two limits show up as the table grows. Core Postgres has no incremental refresh, so each refresh rescans
            the base table. And a rollup only answers the questions you built it for. When customers ask for any
            date range broken down by any column, the number of rollups you would need grows faster than you can
            maintain them.
          </p>
          <h3 className="text-lg font-medium text-text">Partitioning</h3>
          <p>
            Monthly partitions on the event table let Postgres skip months a query does not touch, and dropping a whole
            partition is much cheaper than deleting old rows. It helps date-bounded queries and retention. It does not
            help a query that aggregates every month.
          </p>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Step 5"
        title="Move reports to a read replica"
        intro={
          <>
            <p>
              A replica keeps reports from competing with transactions for CPU, memory and I/O on the primary. Often that is the real complaint. The app slows down while someone runs a report. The reports themselves get no
              faster.
            </p>
            <p>
              Long queries on a hot standby can fail with{' '}
              <code className={inlineCode}>canceling statement due to conflict with recovery</code> when the primary
              cleans up rows the query is still reading. Turning on <code className={inlineCode}>hot_standby_feedback</code>{' '}
              stops the cancellations but holds back vacuum on the primary; raising{' '}
              <code className={inlineCode}>max_standby_streaming_delay</code> lets the replica fall behind instead.
              Pick the one you can live with.
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Step 6"
        title="Postgres analytics extensions"
        intro={
          <p>
            Extensions add a column store or a vectorised engine to Postgres. The question that separates them is where the work runs. Some run on your Postgres server and share its CPU and memory with the app; others send the work somewhere else.
          </p>
        }
      >
        <HubTable
          caption="Postgres analytics extensions compared by what they add and where queries run"
          columns={['Extension', 'What it adds', 'Where queries run', 'Use it for']}
          rows={extensionRows}
        />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            Extensions that run inside Postgres make heavy queries faster but keep them on the same machine as your
            transactions. In a test of 50 million rows published by ClickHouse, the vendor behind pg_clickhouse,
            running analytics in plain Postgres cut read-write throughput by 41%, against 0.2% when pg_clickhouse sent
            the same queries to ClickHouse. Treat a vendor’s numbers with care, but the direction matches how the two
            designs work.
          </p>
          <p>
            Managed Postgres also limits the choice. Most hosted services allow only the extensions on their list, so
            check yours before planning around one.
          </p>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Step 7"
        title="Add ClickHouse for the analytical tables"
        intro={
          <>
            <p>
              The last step keeps Postgres as the system of record and copies the analytical tables into ClickHouse,
              a column store that reads only the columns a query names, compressed. On the same million events, the
              aggregations above took 19 to 61 ms in ClickHouse against 0.7 to 1.7 seconds in Postgres. The gap widens as
              the table grows.
            </p>
            <p>
              Postgres still wins point lookups. One customer’s month took under a millisecond in Postgres and 6 to 10
              ms in ClickHouse. That is why the usual design is both, with each query going to the database that suits
              it. The{' '}
              <Link href="/guides/clickhouse-vs-postgres-app-analytics" className={inlineLink}>
                ClickHouse vs Postgres guide
              </Link>{' '}
              has the full benchmark. To copy the tables across, the{' '}
              <Link href="/postgres-to-clickhouse" className={inlineLink}>
                Postgres to ClickHouse comparison
              </Link>{' '}
              covers ClickPipes, PeerDB, Debezium and managed CDC tools, with the Postgres setup each one needs.
            </p>
          </>
        }
      >
        <div className="max-w-[760px] space-y-4 text-body text-text-muted">
          <h3 className="text-lg font-medium text-text">What changes in your app</h3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-medium text-text">Two databases, joined by id.</strong> Accounts stay in Postgres
              with your ORM. Usage comes from ClickHouse. The app fetches each and merges them by account id, two
              queries with no cross-database SQL. The{' '}
              <Link href="/examples/postgres-app-clickhouse-analytics" className={inlineLink}>
                Postgres + Drizzle example
              </Link>{' '}
              does exactly this.
            </li>
            <li>
              <strong className="font-medium text-text">Events skip Postgres.</strong> Product events, API calls and
              logs can be written straight to ClickHouse in batches, so they never bloat the transactional database.
            </li>
            <li>
              <strong className="font-medium text-text">Replicated tables need FINAL.</strong> CDC writes each update as
              a new row version. Read those tables with <code className={inlineCode}>FINAL</code>, or counts drift up
              until background merges catch up.
            </li>
            <li>
              <strong className="font-medium text-text">One place for metric definitions.</strong> With two databases,
              “active users” is easy to define twice. A typed layer such as hypequery defines it once over ClickHouse and
              serves it to dashboards, the API and agents, with the tenant filter applied for you. The{' '}
              <Link href="/saas-analytics-backend" className={inlineLink}>
                SaaS analytics backend guide
              </Link>{' '}
              walks through the whole setup.
            </li>
          </ul>
        </div>
      </HubSection>

      <HubSection
        id="symptoms"
        eyebrow="Shortcut"
        title="Match the symptom to the fix"
        intro={<p>If you already know what hurts, start here.</p>}
      >
        <HubTable
          caption="Common slow Postgres analytics symptoms and the fix to try first"
          columns={['Symptom', 'Try first']}
          rows={symptomRows}
        />
      </HubSection>

      <HubSection band eyebrow="Questions" title="Postgres analytics FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection eyebrow="Keep reading" title="Benchmarks, examples and next steps">
        <HubLinkGrid links={nextLinks} />
      </HubSection>

      <section className={`${marketing.container} pb-14`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
              Try your slowest query on ClickHouse
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Run ClickHouse locally, load a copy of one table, and compare. The example app keeps your Postgres as it
              is and adds ClickHouse beside it.
            </p>
          </div>
          <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
            <Link
              href="/examples/postgres-app-clickhouse-analytics"
              data-umami-event="cta_click"
              data-umami-event-target="postgres_app_example"
              data-umami-event-location="hub_next_step_primary"
              className={marketing.primaryButton}
            >
              Open the example <span aria-hidden="true">→</span>
            </Link>
            <Link href="/guides/clickhouse-docker-compose" className={marketing.secondaryButton}>
              Run ClickHouse locally
            </Link>
          </div>
        </div>
      </section>

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
