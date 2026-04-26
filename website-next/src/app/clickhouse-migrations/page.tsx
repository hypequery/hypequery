import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Migrations — TypeScript Schema Change Management | hypequery',
  description:
    'ClickHouse schema migrations are painful. hypequery is building TypeScript-first migration tooling for ClickHouse — track changes, run reversible migrations, and keep your schema in sync.',
  robots: {
    index: false,
    follow: true,
  },
  alternates: { canonical: absoluteUrl('/clickhouse-migrations') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-migrations'),
    title: 'ClickHouse Migrations — TypeScript Schema Change Management | hypequery',
    description:
      'TypeScript-first ClickHouse migration tooling — coming soon from hypequery. Reversible schema changes, version tracking, and CLI integration.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Migrations — TypeScript Schema Change Management | hypequery',
    description:
      'ClickHouse schema migrations are painful. hypequery is building TypeScript-first migration tooling — reversible schema changes and CLI integration.',
  },
};

const upcomingMigrationCode = `// coming soon — hypequery migrations API (preview)
import { defineMigration } from '@hypequery/cli';

export default defineMigration({
  up: async (db) => {
    await db.schema
      .alterTable('events')
      .addColumn('session_id', 'String DEFAULT \'\'')
      .execute();
  },
  down: async (db) => {
    await db.schema
      .alterTable('events')
      .dropColumn('session_id')
      .execute();
  },
});`;

const generateCode = `# today — hypequery schema generation
# introspect your live ClickHouse schema and generate TypeScript types

npx @hypequery/cli generate \\
  --host your-clickhouse-host \\
  --output ./src/schema.ts

# re-run after any schema change to keep types in sync`;

export default function ClickHouseMigrationsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Migrations"
      title="TypeScript-first ClickHouse schema migration tooling"
      description="Managing ClickHouse schema changes is harder than it looks. ALTER TABLE has constraints, distributed tables add complexity, and most migration tools were not built for ClickHouse. hypequery is building dedicated TypeScript migration tooling — reversible changes, version tracking, and CLI integration. Schema generation is available today."
      primaryCta={{ href: 'https://github.com/hypequery/hypequery', label: 'Star on GitHub to follow progress' }}
      secondaryCta={{ href: '/docs/quick-start', label: 'Use schema generation today' }}
      stats={[
        { label: 'Schema generation', value: 'Available now' },
        { label: 'Migrations', value: 'Coming soon' },
        { label: 'Language', value: 'TypeScript' },
      ]}
      problems={[
        {
          title: 'ClickHouse ALTER TABLE has constraints other databases do not',
          copy:
            'You cannot change a column type in place. Materialized views, projections, and distributed tables all add coordination complexity. Most migration tools do not account for this and fail silently or require manual workarounds.',
        },
        {
          title: 'No standard migration tooling built for ClickHouse',
          copy:
            'Flyway and Liquibase support ClickHouse in theory but were designed for transactional databases. The ClickHouse-specific patterns — ReplicatedMergeTree, ON CLUSTER DDL, column codec changes — are not first-class.',
        },
        {
          title: 'Schema and TypeScript types drift after every change',
          copy:
            'After an ALTER TABLE runs, your TypeScript interfaces are wrong until someone hand-updates them. On a fast-moving team this is a constant source of silent bugs and runtime errors.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What is coming',
        title: 'ClickHouse-aware migrations that regenerate TypeScript types automatically',
        description:
          'hypequery migrations will be built specifically for ClickHouse — understanding the ALTER TABLE constraints, ON CLUSTER DDL for distributed setups, and running type regeneration automatically after each migration so your schema.ts stays in sync without a manual step.',
        bullets: [
          'Migration files in TypeScript with up/down definitions',
          'ClickHouse-aware schema operations — ADD COLUMN, MODIFY COLUMN where supported, and safe alternatives where not',
          'Automatic TypeScript type regeneration after every migration run',
          'Version tracking and migration history stored in ClickHouse',
          'CLI integration with the existing @hypequery/cli toolchain',
        ],
        codePanel: {
          eyebrow: 'Preview API',
          title: 'TypeScript migration definition (coming soon)',
          description:
            'This is a preview of the migrations API under development. The exact interface may change before release — star on GitHub to follow the design.',
          code: upcomingMigrationCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Available today',
        title: 'Schema generation keeps TypeScript types in sync right now',
        description:
          'While full migration tooling is in development, schema generation is available today. Run it after any manual schema change and your TypeScript types update immediately — no hand-editing interfaces.',
        paragraphs: [
          'Teams currently using hypequery run schema generation as part of their deployment step. When a schema change lands in ClickHouse, the next generate run picks it up and updates every table and column type automatically.',
          'Star on GitHub or watch the repository to be notified when migrations land. In the meantime, the quick start covers schema generation and typed queries.',
        ],
        codePanel: {
          eyebrow: 'Available now',
          title: 'Schema generation — keep types in sync after any change',
          description:
            'Run this after any ALTER TABLE or schema change. Your TypeScript types update to match the live ClickHouse schema — correct mappings for DateTime, UInt64, Nullable, and Decimal included.',
          code: generateCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse schema migration tools',
          copy:
            'Most migration tools (Flyway, Liquibase, golang-migrate) support ClickHouse at a basic level but do not account for ClickHouse-specific DDL constraints. hypequery migrations are aimed at the narrower problem TypeScript teams actually have: schema changes plus generated types that need to stay in sync.',
        },
        {
          title: 'ClickHouse ALTER TABLE TypeScript',
          copy:
            'When you run an ALTER TABLE in ClickHouse, your TypeScript types are immediately out of sync. hypequery schema generation fixes this today — run generate and your types update to match the live schema.',
        },
        {
          title: 'ClickHouse schema versioning',
          copy:
            'Versioning ClickHouse schema changes is harder than in transactional databases. The hypequery migrations approach stores version history in ClickHouse itself, making it visible alongside your analytics data.',
        },
        {
          title: 'ClickHouse DDL in TypeScript',
          copy:
            'Writing raw DDL strings for ClickHouse schema changes is error-prone and disconnected from your TypeScript codebase. hypequery migrations will expose a typed DDL API that integrates directly with schema generation.',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/quick-start',
          title: 'Quick start — schema generation',
          description: 'Generate TypeScript types from your live ClickHouse schema and write your first typed query.',
        },
        {
          href: '/clickhouse-schema',
          title: 'ClickHouse schema management',
          description: 'How hypequery introspects your ClickHouse schema and generates correct TypeScript type mappings.',
        },
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse TypeScript',
          description: 'The full TypeScript workflow — schema types, typed queries, HTTP APIs, and React hooks.',
        },
        {
          href: 'https://github.com/hypequery/hypequery',
          title: 'GitHub — follow development',
          description: 'Star the repo to be notified when migrations land and to follow the API design process.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-schema', label: 'ClickHouse Schema' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-nodejs', label: 'ClickHouse Node.js' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Use schema generation while migrations are in development',
        description:
          'Run npx @hypequery/cli generate to introspect your ClickHouse schema and generate TypeScript types today. Star on GitHub to follow migrations progress.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with schema generation' },
        secondaryCta: { href: 'https://github.com/hypequery/hypequery', label: 'Star on GitHub' },
      }}
    />
  );
}
