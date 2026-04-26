import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse ORM for TypeScript — Schema-Driven Query Layer | hypequery',
  description:
    'There is no Prisma for ClickHouse — but hypequery is the closest equivalent. Schema-generated types, a composable query builder, and typed HTTP APIs for ClickHouse analytics.',
  alternates: { canonical: absoluteUrl('/clickhouse-orm') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-orm'),
    title: 'ClickHouse ORM for TypeScript — Schema-Driven Query Layer | hypequery',
    description:
      'hypequery gives you the schema-first, type-safe experience of an ORM for ClickHouse — without the overhead or the wrong abstractions.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse ORM for TypeScript | hypequery',
    description:
      'There is no Prisma for ClickHouse — hypequery is the closest equivalent. Schema-generated types, composable queries, typed HTTP APIs.',
  },
};

const generateCode = `# generate TypeScript types from your live ClickHouse schema
npx @hypequery/cli generate --output ./src/schema.ts

# schema.ts output:
# export interface DB {
#   orders: {
#     id: string;           // UUID
#     total: string;        // Decimal(18,4)
#     created_at: string;   // DateTime
#     tenant_id: string;    // String
#   };
# }`;

const queryCode = `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { DB } from './schema';

const db = createQueryBuilder<DB>({ host: process.env.CLICKHOUSE_HOST });

// fully typed — autocomplete on table names, column names, and return values
const orders = await db
  .table('orders')
  .select('id', 'total', 'created_at')
  .where('tenant_id', 'eq', tenantId)
  .where('status', 'eq', 'completed')
  .orderBy('created_at', 'DESC')
  .limit(100)
  .execute();

// orders: { id: string; total: string; created_at: string }[]`;

export default function ClickHouseOrmPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse ORM"
      title="The closest thing to a TypeScript ORM for ClickHouse"
      description="Prisma, Drizzle, and Kysely were built for transactional databases. ClickHouse is an analytics database with a fundamentally different data model — and it needs a different tool. hypequery gives you the schema-first, type-safe developer experience of an ORM without the wrong abstractions."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/clickhouse-query-builder', label: 'See the query builder' }}
      stats={[
        { label: 'Type source', value: 'Generated from live schema' },
        { label: 'Target database', value: 'ClickHouse native' },
        { label: 'Best for', value: 'Analytics-heavy TypeScript apps' },
      ]}
      problems={[
        {
          title: 'Transactional ORMs are the wrong abstraction for ClickHouse',
          copy:
            'Prisma and Drizzle model rows, relationships, and transactions. ClickHouse is columnar, append-optimised, and designed for aggregations over billions of rows — not joins and foreign keys. Forcing a relational ORM onto it produces awkward code and missing features.',
        },
        {
          title: 'Kysely and generic query builders do not understand ClickHouse types',
          copy:
            'Kysely is excellent for Postgres. For ClickHouse it needs adapting: DateTime returns as a string, UInt64 returns as a string, Nullable works differently. You end up hand-writing type mappings that drift from reality.',
        },
        {
          title: '@clickhouse/client gives you a connection but no structure',
          copy:
            'The official client runs queries and returns untyped results. You get full control but you also build the entire type layer, reuse layer, and API layer yourself — which most teams end up reinventing repeatedly.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How hypequery works',
        title: 'Schema-first types and composable queries, built for ClickHouse',
        description:
          'hypequery introspects your live ClickHouse schema and generates a TypeScript interface for every table and column — with correct ClickHouse-to-TypeScript type mappings. You then build queries using a fluent builder that understands ClickHouse natively.',
        bullets: [
          'Schema types generated from your live ClickHouse database — not hand-written',
          'Correct runtime mappings: DateTime→string, UInt64→string, Nullable→T|null',
          'Composable query builder with typed filters, joins, CTEs, and raw SQL escape hatches',
          'Same query definition runs inline, over HTTP, or as a React hook',
          'OpenAPI docs generated automatically from query definitions',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Generate types from your ClickHouse schema',
          description:
            'One command introspects your live ClickHouse instance and outputs a TypeScript interface for every table. This is what makes the query builder fully typed without hand-maintaining interfaces.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Build typed queries from generated schema',
        description:
          'The query builder uses the generated schema types so every table name, column name, and return value is fully typed. Autocomplete works. Refactors are safe. The schema stays in sync by re-running generate.',
        paragraphs: [
          'This is the ORM-like experience for ClickHouse — not a relational ORM adapted to fit, but a tool designed from the ground up for the ClickHouse data model and the TypeScript developer workflow.',
          'Read the query builder guide or the comparison with @clickhouse/client to understand exactly what you get and where the boundaries are.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'Typed queries from generated schema',
          description:
            'Autocomplete on table names and column names. Return types inferred from the schema. No hand-written interfaces, no silent drift when columns change.',
          code: queryCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse ORM TypeScript',
          copy:
            'There is no Prisma or Drizzle for ClickHouse — the data model is too different. hypequery is the schema-driven, type-safe query layer that fills that gap, built specifically for ClickHouse analytics workloads.',
        },
        {
          title: 'Prisma alternative for ClickHouse',
          copy:
            'Prisma does not support ClickHouse. hypequery gives you the same schema-first experience — generate types from your database, build typed queries, and get autocomplete — without needing a relational data model.',
        },
        {
          title: 'Drizzle alternative for ClickHouse',
          copy:
            'Drizzle does not support ClickHouse. hypequery is the TypeScript-first ClickHouse alternative — schema generation, a composable query builder, and typed HTTP APIs designed for analytics-heavy applications.',
        },
        {
          title: 'Type-safe ClickHouse queries without hand-written interfaces',
          copy:
            'The core ORM value proposition — types that come from the database, not from your imagination — is exactly what hypequery provides for ClickHouse. Run generate, get types, build queries.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description: 'The full composable query builder — filters, aggregations, joins, CTE helpers, and practical escape hatches.',
        },
        {
          href: '/compare/hypequery-vs-clickhouse-client',
          title: 'hypequery vs @clickhouse/client',
          description: 'What you gain moving from raw queries to a typed, structured analytics layer.',
        },
        {
          href: '/compare/hypequery-vs-kysely',
          title: 'hypequery vs Kysely',
          description: 'Where Kysely is excellent, where ClickHouse changes the tradeoffs, and when hypequery fits better.',
        },
        {
          href: '/clickhouse-schema',
          title: 'ClickHouse schema generation',
          description: 'How the schema introspection and type generation process works in detail.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-schema', label: 'ClickHouse Schema' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Generate schema types and write your first typed query',
        description:
          'Run schema generation against your ClickHouse instance, then build a typed query. The whole setup takes under five minutes.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/clickhouse-query-builder', label: 'See the query builder' },
      }}
    />
  );
}
