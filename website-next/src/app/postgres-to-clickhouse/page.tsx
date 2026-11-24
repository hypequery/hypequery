import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, HubSources, HubTable, type HubLink } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

// Hub for moving Postgres data into ClickHouse. It compares the replication
// options (CDC, managed pipelines, batch) and covers what to do once rows land.
// The ClickHouse vs Postgres guide keeps the "which database" question and the
// benchmark; this page owns "how do I get the data across".
const PATH = '/postgres-to-clickhouse';
const TITLE = 'Postgres to ClickHouse: CDC, PeerDB, Debezium Compared';
const DESCRIPTION =
  'Every way to replicate Postgres to ClickHouse: ClickPipes, PeerDB, Debezium, managed CDC and batch copies, plus how to query deletes and updates once they land.';
const PUBLISHED = '2026-11-24';
const UPDATED = updatedFor(PATH);
// Tool behaviour, status and pricing were checked against each vendor's docs
// and pricing page (listed in Sources) on this date.
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
    images: ogImage('Postgres to ClickHouse'),
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

const optionRows = [
  [
    'ClickPipes Postgres CDC',
    'Managed CDC inside ClickHouse Cloud, built on PeerDB',
    'About 60 s by default, configurable',
    'Yes, as flagged rows',
    'No',
    'ClickHouse Cloud only',
  ],
  [
    'PeerDB',
    'Open-source CDC (AGPL-3.0) you run yourself',
    'Seconds to a minute',
    'Yes, as flagged rows',
    'No',
    'Self-hosted, with Docker Compose',
  ],
  [
    'Debezium + Kafka',
    'Debezium reads the WAL into Kafka; a sink or materialized view writes to ClickHouse',
    'Seconds',
    'Only with a delete-aware table design',
    'Yes',
    'Self-hosted, or managed Kafka',
  ],
  [
    'Managed ELT (Fivetran, Airbyte, Estuary, Streamkap, Artie)',
    'A vendor runs the CDC pipeline for you',
    'Sub-minute to the sync interval you pay for',
    'Yes, each with its own delete column',
    'No',
    'Vendor cloud; Airbyte also self-hosted',
  ],
  [
    'Batch copy with postgresql()',
    'A scheduled INSERT … SELECT from Postgres',
    'Minutes to hours',
    'No, hard deletes are missed',
    'No',
    'Any ClickHouse',
  ],
  [
    'MaterializedPostgreSQL engine',
    'ClickHouse replicates from Postgres itself',
    'Seconds',
    'Yes',
    'No',
    'Experimental; not in ClickHouse Cloud',
  ],
];

const pgSetupSql = `-- 1. Turn on logical decoding (a restart, or your provider's parameter group)
--    wal_level = logical

-- 2. A dedicated user, not a superuser
CREATE ROLE clickhouse_cdc WITH LOGIN REPLICATION PASSWORD '<password>';
GRANT USAGE ON SCHEMA public TO clickhouse_cdc;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO clickhouse_cdc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO clickhouse_cdc;

-- 3. Publish only the tables you want in ClickHouse
CREATE PUBLICATION clickhouse_pub FOR TABLE subscriptions, invoices, events;

-- 4. Watch the slot: a stalled pipeline keeps WAL on disk until it catches up
SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;`;

// Simplified from the ClickPipes Postgres CDC docs; exact column types follow the source table.
const cdcTargetSql = `-- What ClickPipes or PeerDB creates for a Postgres "subscriptions" table
CREATE TABLE app.subscriptions
(
    id                  Int64,
    tenant_id           String,
    plan                String,
    status              String,
    mrr_cents           Int64,
    _peerdb_synced_at   DateTime64(9),
    _peerdb_is_deleted  Int8,
    _peerdb_version     Int64
)
ENGINE = ReplacingMergeTree(_peerdb_version)
ORDER BY id;`;

const cdcQuerySql = `-- Correct current state: newest version of each row, deleted rows removed
SELECT plan, count() AS subscriptions, sum(mrr_cents) / 100 AS mrr
FROM app.subscriptions FINAL
WHERE _peerdb_is_deleted = 0
  AND status = 'active'
GROUP BY plan;`;

const batchSql = `-- Target: ENGINE = ReplacingMergeTree(updated_at) ORDER BY id,
-- so a row copied twice keeps only its newest version.
-- Re-read an overlap window each run: a transaction can commit after rows with
-- later timestamps were already copied. Deletes in Postgres are never seen.
INSERT INTO app.subscriptions_batch
SELECT id, tenant_id, plan, status, mrr_cents, updated_at
FROM postgresql('pg-host:5432', 'app', 'subscriptions', 'readonly_user', '<password>')
WHERE updated_at > (SELECT max(updated_at) FROM app.subscriptions_batch) - INTERVAL 15 MINUTE;`;

const datasetCode = `import { dataset, dimension, measure } from '@hypequery/datasets';

// app.subscriptions is replicated from Postgres by ClickPipes or PeerDB.
export const Subscriptions = dataset('subscriptions', {
  source: 'app.subscriptions',
  tenantKey: 'tenant_id', // every query is filtered to one customer
  // Read with FINAL and drop rows deleted in Postgres, on every query
  rowResolution: { kind: 'final', engine: 'replacing', deletedColumn: '_peerdb_is_deleted' },
  dimensions: {
    id: dimension.number(),
    plan: dimension.string(),
    status: dimension.string(),
    mrrCents: dimension.number({ column: 'mrr_cents' }),
  },
  measures: {
    subscriptions: measure.count('id', { label: 'Subscriptions' }),
    mrrCents: measure.sum('mrrCents', { label: 'MRR (cents)' }),
  },
});`;

const pitfallRows = [
  [
    'Counts are too high after updates',
    'ReplacingMergeTree keeps old versions until a background merge. Read with FINAL, or argMax by key.',
  ],
  [
    'Deleted customers still show up',
    'The delete arrives as a row with _peerdb_is_deleted = 1. Filter it out, or let the dataset do it.',
  ],
  [
    'Postgres disk fills up',
    'A paused or broken pipeline leaves its slot holding WAL. Alert on retained WAL, and set max_slot_wal_keep_size (Postgres 13+).',
  ],
  [
    'A dropped column is still in ClickHouse',
    'ClickPipes propagates ADD COLUMN, but only detects DROP COLUMN. Drop it in ClickHouse yourself.',
  ],
  [
    'TRUNCATE did nothing',
    'ClickPipes does not replicate TRUNCATE. Truncate the ClickHouse table as well, or resync.',
  ],
  [
    'The pipeline cannot connect through the pooler',
    'Logical replication needs a direct connection. PgBouncer, RDS Proxy and the Supabase pooler are not supported by ClickPipes.',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is the best way to replicate Postgres to ClickHouse?',
    answer:
      'On ClickHouse Cloud, use ClickPipes Postgres CDC. It is managed, needs no Kafka and supports RDS, Aurora, Cloud SQL, Supabase, Neon and most other managed Postgres services. Self-hosted, run PeerDB, the open-source engine behind ClickPipes. Use Debezium if you already run Kafka, and a scheduled postgresql() copy for small tables or a first prototype.',
  },
  {
    question: 'Do I need Kafka to stream Postgres into ClickHouse?',
    answer:
      'No. ClickPipes, PeerDB, Estuary, Fivetran, Airbyte and the MaterializedPostgreSQL engine all read the Postgres write-ahead log without Kafka. Debezium is the option that usually brings Kafka with it, since its ClickHouse path goes through Kafka Connect.',
  },
  {
    question: 'How do updates and deletes work in ClickHouse after CDC?',
    answer:
      'Each change arrives as a new row with a version number in a ReplacingMergeTree table. An update is a newer version, and a delete is a newer version with a deleted flag set (_peerdb_is_deleted = 1 for ClickPipes and PeerDB). Background merges keep the newest version eventually, so queries that need exact current state read with FINAL and filter out the deleted flag.',
  },
  {
    question: 'Is PeerDB still open source?',
    answer:
      'Yes. ClickHouse Inc. acquired PeerDB in 2024 and it now powers ClickPipes, but the repository is still public under AGPL-3.0 and gets regular releases. ClickHouse and Postgres are its maintained destinations; the others are marked deprecated.',
  },
  {
    question: 'Can ClickHouse query Postgres directly without copying data?',
    answer:
      'Yes, with the postgresql() table function or the PostgreSQL table engine. ClickHouse pushes simple filters and the column list down, but Postgres still reads and sends every matching row, so it suits small lookup tables and backfills rather than heavy aggregations.',
  },
  {
    question: 'Does replicating to ClickHouse slow down my Postgres database?',
    answer:
      'Logical decoding adds some CPU and WAL reading on the primary, which is usually small next to the analytics queries it takes off Postgres. The real risk is a stalled pipeline, because its replication slot keeps WAL on disk until it catches up. Monitor retained WAL and cap it with max_slot_wal_keep_size.',
  },
];

const nextLinks: HubLink[] = [
  {
    href: '/guides/clickhouse-vs-postgres-app-analytics',
    title: 'ClickHouse vs Postgres for app analytics',
    description: 'When Postgres is enough, the benchmark, and the signs it is time to add ClickHouse.',
  },
  {
    href: '/blog/clickhouse-final-replacingmergetree-typescript',
    title: 'ClickHouse FINAL and ReplacingMergeTree',
    description: 'What FINAL costs, and when argMax or LIMIT BY is the better read.',
  },
  {
    href: '/examples/postgres-app-clickhouse-analytics',
    title: 'Postgres + Drizzle app with ClickHouse analytics',
    description: 'A runnable app that keeps Postgres and adds ClickHouse beside it.',
  },
  {
    href: '/blog/postgres-mysql-to-clickhouse-sql-equivalents',
    title: 'Postgres to ClickHouse SQL equivalents',
    description: 'What each common Postgres query looks like once the table moves.',
  },
  {
    href: '/blog/managed-clickhouse-services-compared',
    title: 'Managed ClickHouse services compared',
    description: 'Where to run the ClickHouse side, and which services include ingestion.',
  },
  {
    href: '/clickhouse-saas-analytics',
    title: 'ClickHouse embedded analytics for SaaS',
    description: 'Tenant isolation, query limits and caching once the data is in ClickHouse.',
  },
];

const sources = [
  {
    vendor: 'ClickHouse docs',
    urls: [
      'https://clickhouse.com/docs/integrations/clickpipes/postgres',
      'https://clickhouse.com/docs/integrations/clickpipes/postgres/faq',
      'https://clickhouse.com/docs/integrations/clickpipes/postgres/schema-changes',
      'https://clickhouse.com/docs/integrations/clickpipes/postgres/deduplication',
      'https://clickhouse.com/docs/cloud/reference/billing/clickpipes/postgres-cdc',
      'https://clickhouse.com/docs/engines/table-engines/mergetree-family/replacingmergetree',
      'https://clickhouse.com/docs/engines/database-engines/materialized-postgresql',
      'https://clickhouse.com/docs/sql-reference/table-functions/postgresql',
      'https://clickhouse.com/docs/integrations/kafka/clickhouse-kafka-connect-sink',
    ],
  },
  {
    vendor: 'PeerDB and Debezium',
    urls: [
      'https://github.com/PeerDB-io/peerdb',
      'https://debezium.io/documentation/reference/stable/connectors/postgresql.html',
      'https://debezium.io/documentation/reference/stable/operations/debezium-server.html',
    ],
  },
  {
    vendor: 'Managed pipelines',
    urls: [
      'https://fivetran.com/docs/destinations/clickhouse',
      'https://docs.airbyte.com/integrations/destinations/clickhouse',
      'https://docs.estuary.dev/reference/Connectors/materialization-connectors/clickhouse/',
      'https://artie.com/docs/destinations/clickhouse',
      'https://streamkap.com/pricing',
    ],
  },
  {
    vendor: 'PostgreSQL docs',
    urls: [
      'https://www.postgresql.org/docs/current/logical-replication.html',
      'https://www.postgresql.org/docs/current/runtime-config-replication.html',
    ],
  },
];

export default function PostgresToClickHousePage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Postgres to ClickHouse' }]}
      eyebrow="Postgres to ClickHouse"
      title="Postgres to ClickHouse: how to move the data, and how to query it once it lands"
      updated={UPDATED}
      lead={
        <p>
          Your app stays on Postgres and analytics moves to ClickHouse. That leaves two jobs. Keep ClickHouse in step
          with Postgres, and query the copy correctly, because updates and deletes arrive as new rows. This page
          compares the ways to do the first and shows how to get the second right.
        </p>
      }
      primaryCta={{ href: '#options', label: 'Compare the options', target: 'pg_to_ch_options' }}
      secondaryCta={{ href: '#querying', label: 'Query replicated tables', target: 'pg_to_ch_querying' }}
      definition={{
        term: 'What is the best way to get Postgres data into ClickHouse?',
        body: (
          <p>
            For most teams it is change data capture (CDC) from the Postgres write-ahead log. On ClickHouse Cloud that
            means ClickPipes. Self-hosted, it means PeerDB, the open-source engine behind ClickPipes. Neither needs
            Kafka. Use Debezium if Kafka is already part of your stack, and a scheduled{' '}
            <code className={inlineCode}>postgresql()</code> copy for small tables or a first prototype.
          </p>
        ),
      }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        id="options"
        eyebrow="The options"
        title="Six ways to replicate Postgres to ClickHouse"
        intro={
          <p>
            All of them except the batch copy read the Postgres write-ahead log (WAL), so they see every insert, update
            and delete. They differ in where they run, whether Kafka is involved, and what you pay.
          </p>
        }
      >
        <HubTable
          caption="Postgres to ClickHouse replication options compared"
          columns={['Option', 'What it is', 'Freshness', 'Deletes', 'Kafka', 'Runs where']}
          rows={optionRows}
        />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            <strong className="text-text">ClickPipes</strong> is the shortest path if you are on ClickHouse Cloud. It
            has been generally available since May 2025. It takes an initial snapshot, then streams changes, and it
            supports RDS, Aurora, Cloud SQL, AlloyDB, Azure, Supabase, Neon, PlanetScale and Crunchy Bridge. You pay
            $0.20 per GB of changes, $0.10 per GB for initial loads, and an hourly compute charge per service.
          </p>
          <p>
            <strong className="text-text">PeerDB</strong> is the same engine, open source and self-hosted. It runs as a
            handful of services (Temporal, workers, a catalog Postgres and object storage for staging), so budget for
            operating it. It lands data in the same table shape as ClickPipes, which keeps a later move to Cloud easy.
          </p>
          <p>
            <strong className="text-text">Debezium</strong> is the long-standing open-source CDC tool, and the
            natural pick if you already run Kafka. Its usual ClickHouse path is Debezium to Kafka, then the ClickHouse
            Kafka Connect sink or a Kafka table and materialized view. The sink does not handle deletes on its own, so
            deletes need a ReplacingMergeTree with a deleted column built from Debezium’s <code className={inlineCode}>op</code> field.
            Debezium Server runs without Kafka but has no ClickHouse sink.
          </p>
          <p>
            <strong className="text-text">Managed ELT tools</strong> trade money for not running anything. Fivetran
            prices by monthly active rows, Estuary and Streamkap by volume, Artie by rows, and Airbyte by credits or for
            free self-hosted. Each writes its own version and delete columns, so check which ones before you write
            queries.
          </p>
          <p>
            <strong className="text-text">Batch copies</strong> need no replication setup at all. ClickHouse reads
            from Postgres with the <code className={inlineCode}>postgresql()</code> table function. They are fine for
            small or append-only tables. Two limits come with a watermark on{' '}
            <code className={inlineCode}>updated_at</code>. It never sees a hard delete, and a transaction that commits
            late can carry an older timestamp than rows already copied. Re-read a window longer than your longest write transaction on every run into a
            ReplacingMergeTree keyed on the primary key, as below, or reload small tables in full.
          </p>
          <p>
            <strong className="text-text">MaterializedPostgreSQL</strong> makes ClickHouse replicate from Postgres
            itself. It is still marked experimental, is not available in ClickHouse Cloud, and stops replicating a
            table when its schema changes until you re-attach it. Keep it for experiments.
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={batchSql} filename="batch-copy.sql" language="sql" />
        </div>
      </HubSection>

      <HubSection
        id="postgres-setup"
        band
        eyebrow="Postgres side"
        title="What every CDC option needs from Postgres"
        intro={
          <p>
            The setup is the same whichever tool reads the WAL: logical decoding switched on, a user with the{' '}
            <code className={inlineCode}>REPLICATION</code> attribute, a publication listing the tables, and a
            replication slot the tool creates and keeps.
          </p>
        }
      >
        <CodeWindow code={pgSetupSql} filename="postgres-setup.sql" language="sql" />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            On managed Postgres you turn logical decoding on through the provider instead:{' '}
            <code className={inlineCode}>rds.logical_replication = 1</code> in the parameter group on RDS and Aurora,
            the <code className={inlineCode}>cloudsql.logical_decoding</code> flag on Cloud SQL, and the logical
            replication setting in Neon. Connect the pipeline directly to the database, not through a connection
            pooler.
          </p>
          <p>
            Tables need a primary key, or a replica identity, so the tool can tell which row an update or delete belongs
            to. The slot is the part to watch: if the pipeline stops, Postgres keeps every WAL segment the slot has not
            confirmed, and the disk fills. Alert on the retained WAL from the query above, and set{' '}
            <code className={inlineCode}>max_slot_wal_keep_size</code> to cap it.
          </p>
        </div>
      </HubSection>

      <HubSection
        id="querying"
        eyebrow="After the rows land"
        title="Querying replicated tables correctly"
        intro={
          <p>
            CDC never edits a row in ClickHouse. Every update and delete is written as a new row with a higher version
            in a ReplacingMergeTree table, ordered by the Postgres primary key.
          </p>
        }
      >
        <CodeWindow code={cdcTargetSql} filename="cdc-target.sql" language="sql" />
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            Background merges keep only the newest version of each row, but they run when ClickHouse decides to. Until
            then a plain query counts an updated row twice and still counts deleted rows. Exact answers need{' '}
            <code className={inlineCode}>FINAL</code> and a filter on the delete flag:
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={cdcQuerySql} filename="current-state.sql" language="sql" />
        </div>
        <div className="mt-8 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            That is easy in one query and easy to forget in the fiftieth. With hypequery you declare it once on the
            dataset. Every query through it reads with <code className={inlineCode}>FINAL</code>, drops deleted rows
            and is filtered to the calling customer, whether it comes from your API, a React hook or an AI agent.
          </p>
        </div>
        <div className="mt-6">
          <CodeWindow code={datasetCode} filename="analytics/subscriptions.ts" language="typescript" />
        </div>
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            Append-only tables such as events never change, so they need none of this. Land them in a plain MergeTree.
            For when <code className={inlineCode}>FINAL</code> gets expensive and what to use instead, read{' '}
            <Link href="/blog/clickhouse-final-replacingmergetree-typescript" className={inlineLink}>
              ClickHouse FINAL and ReplacingMergeTree
            </Link>
            . To serve these datasets to customers, see{' '}
            <Link href="/clickhouse-saas-analytics" className={inlineLink}>
              ClickHouse embedded analytics for SaaS
            </Link>
            .
          </p>
        </div>
      </HubSection>

      <HubSection
        id="pitfalls"
        band
        eyebrow="Pitfalls"
        title="What goes wrong after go-live"
        intro={<p>Most CDC problems show up as wrong numbers rather than errors.</p>}
      >
        <HubTable
          caption="Common Postgres to ClickHouse replication problems and their fixes"
          columns={['Symptom', 'Cause and fix']}
          rows={pitfallRows}
        />
      </HubSection>

      <HubSection eyebrow="Questions" title="Postgres to ClickHouse FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection band eyebrow="Keep reading" title="Benchmarks, examples and next steps">
        <HubLinkGrid links={nextLinks} />
      </HubSection>

      <section className={`${marketing.container} py-14`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
              See Postgres and ClickHouse side by side in one app
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              The example keeps a Postgres and Drizzle app as it is, adds ClickHouse for analytics, and queries both
              with typed code.
            </p>
          </div>
          <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
            <Link
              href="/examples/postgres-app-clickhouse-analytics"
              data-umami-event="cta_click"
              data-umami-event-target="postgres_app_example"
              data-umami-event-location="pg_to_ch_next_step_primary"
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
