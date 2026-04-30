import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'TypeORM for ClickHouse: Better Alternative for TypeScript | hypequery',
  description:
    'Looking for TypeORM on ClickHouse? TypeORM is not a natural fit for ClickHouse analytics workloads. hypequery is the TypeScript-first alternative for generated schema types and ClickHouse queries.',
  alternates: { canonical: absoluteUrl('/typeorm-clickhouse') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/typeorm-clickhouse'),
    title: 'TypeORM for ClickHouse: Better Alternative for TypeScript | hypequery',
    description:
      'TypeORM is built for relational transactional workflows. If you need a TypeScript-native workflow for ClickHouse analytics, hypequery is the closer fit.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TypeORM for ClickHouse | hypequery',
    description:
      'TypeORM is not a natural fit for ClickHouse analytics workloads. Use hypequery for generated types, composable ClickHouse queries, and reusable APIs.',
  },
};

const generateCode = `# introspect your live ClickHouse schema
npx @hypequery/cli generate --output ./src/schema.ts

# generated types reflect ClickHouse runtime behaviour:
# DateTime -> string
# UInt64   -> string
# Nullable -> T | null`;

const queryCode = `import { createQueryBuilder, rawAs, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
});

const retention = await db
  .table('events')
  .select([
    selectExpr('toStartOfWeek(created_at)', 'week'),
    rawAs('uniq(user_id)', 'active_users'),
  ])
  .where('event_type', 'eq', 'session')
  .groupBy('week')
  .orderBy('week', 'ASC')
  .execute();`;

export default function TypeormClickHousePage() {
  return (
    <ClickhousePillarPage
      eyebrow="TypeORM ClickHouse"
      title="Looking for TypeORM on ClickHouse?"
      description="TypeORM is built around relational entities, transactions, and table relationships. ClickHouse is a columnar analytics database with a different type model and a different query shape. If what you actually want is a TypeScript workflow for ClickHouse analytics, hypequery is the closer fit."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-orm', label: 'See the ClickHouse ORM page' }}
      stats={[
        { label: 'TypeORM fit', value: 'Relational app databases' },
        { label: 'hypequery fit', value: 'ClickHouse analytics workloads' },
        { label: 'Type source', value: 'Generated from live schema' },
      ]}
      problems={[
        {
          title: 'TypeORM models entities and relations, not ClickHouse analytics workflows',
          copy:
            'TypeORM is strong when your database behaves like Postgres or MySQL. ClickHouse is optimized for append-heavy analytics, large scans, and aggregation rather than entity graphs and row-level transactional updates.',
        },
        {
          title: 'ClickHouse runtime values do not match normal ORM assumptions',
          copy:
            'DateTime values come back as strings, UInt64 values come back as strings to avoid precision loss, and ClickHouse-specific clauses like PREWHERE and ARRAY JOIN do not fit neatly into a traditional ORM abstraction.',
        },
        {
          title: 'Analytics teams usually need reusable delivery paths as well as typed queries',
          copy:
            'Once ClickHouse data powers app features, internal tools, and dashboards, the problem becomes shared query definitions and safe reuse, not just entity mapping.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What to use',
        title: 'Use hypequery as the ClickHouse-native TypeScript layer',
        description:
          'hypequery gives you the part of the TypeORM experience that matters for ClickHouse: schema-generated types, fluent queries in TypeScript, and a path to reuse those query definitions across scripts, HTTP endpoints, and frontend code.',
        bullets: [
          'Generate TypeScript types from your live ClickHouse schema',
          'Use a composable query builder built for ClickHouse query patterns',
          'Keep runtime type mappings accurate: DateTime, UInt64, Decimal, Nullable',
          'Promote queries into typed REST endpoints and OpenAPI docs when teams need shared delivery',
          'Use React hooks on the same query contract when dashboards need the same data',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Generate types from the real schema',
          description:
            'This keeps TypeScript aligned with actual ClickHouse runtime behaviour instead of forcing relational ORM conventions onto a columnar engine.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Write typed ClickHouse queries instead of entity-oriented ORM code',
        description:
          'ClickHouse-heavy TypeScript applications usually want composable queries, aggregation helpers, and safe reuse of query logic. hypequery stays close to that shape rather than abstracting it behind entity patterns.',
        paragraphs: [
          'If your stack already uses TypeORM with Postgres or MySQL, the clean split is often TypeORM for transactional application data and hypequery for ClickHouse analytics.',
          'That keeps each tool aligned to the database shape it was built for instead of forcing one abstraction to cover two very different systems.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'Query ClickHouse with generated types',
          description:
            'A realistic ClickHouse query usually looks more like analytics SQL than entity loading. This is where a ClickHouse-specific TypeScript layer is more useful than a classic ORM pattern.',
          code: queryCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Does TypeORM support ClickHouse?',
          copy:
            'TypeORM is not the natural tool for ClickHouse analytics workloads. If you need a TypeScript-first workflow for ClickHouse, hypequery is the more direct fit.',
        },
        {
          title: 'TypeORM alternative for ClickHouse',
          copy:
            'The better fit is a schema-generated ClickHouse query layer rather than a relational entity ORM. hypequery gives you generated types, fluent queries, and typed APIs around ClickHouse.',
        },
        {
          title: 'ORM for ClickHouse',
          copy:
            'The practical need is usually type-safe queries and reusable delivery paths, not relational entity mapping. That is the gap hypequery closes for ClickHouse teams.',
        },
        {
          title: 'Use TypeORM with Postgres and ClickHouse together',
          copy:
            'A common architecture is TypeORM for transactional Postgres or MySQL data and hypequery for ClickHouse analytics. Each tool stays inside the workload shape it was designed for.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-orm',
          title: 'ClickHouse ORM',
          description: 'The broader page for teams looking for an ORM-like workflow on ClickHouse.',
        },
        {
          href: '/drizzle-clickhouse',
          title: 'Drizzle ORM for ClickHouse',
          description: 'Another dedicated unsupported-ORM intent page aimed at teams coming from Drizzle rather than TypeORM.',
        },
        {
          href: '/clickhouse-schema',
          title: 'ClickHouse schema generation',
          description: 'See how live-schema introspection becomes TypeScript types that match actual ClickHouse runtime values.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse query builder',
          description: 'See the query-builder layer in more detail, including filters, aggregations, joins, and raw SQL escape hatches.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-orm', label: 'ClickHouse ORM' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-schema', label: 'ClickHouse Schema' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Generate your ClickHouse schema types and try one real analytics query',
        description:
          'That is the fastest way to tell whether the TypeORM-style ClickHouse workflow you want is really a generated-schema query-layer problem instead.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-orm', label: 'See the ORM page' },
      }}
    />
  );
}
