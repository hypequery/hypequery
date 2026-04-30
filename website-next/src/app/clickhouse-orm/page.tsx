import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ORM for ClickHouse in TypeScript | hypequery',
  description:
    'Looking for an ORM for ClickHouse? Prisma, Drizzle, and TypeORM do not fit ClickHouse well. hypequery is the schema-driven TypeScript alternative for analytics work.',
  alternates: { canonical: absoluteUrl('/clickhouse-orm') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-orm'),
    title: 'ORM for ClickHouse in TypeScript | hypequery',
    description:
      'If you need an ORM-like workflow for ClickHouse, hypequery gives you generated schema types, composable queries, and typed APIs without forcing relational abstractions onto an analytics database.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ORM for ClickHouse in TypeScript | hypequery',
    description:
      'Looking for an ORM for ClickHouse? hypequery is the schema-driven TypeScript alternative for ClickHouse analytics teams.',
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
      title="The closest thing to an ORM for ClickHouse"
      description="Most teams searching for an ORM for ClickHouse are not looking for relations or migrations. They want generated types, query composition, and a way to reuse analytics logic without hand-maintaining interfaces. Prisma, Drizzle, and TypeORM were built for transactional databases. hypequery is built for ClickHouse."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-schema', label: 'Generate schema types now' }}
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
          title: 'Most teams searching for a ClickHouse ORM actually need a reusable query layer',
          copy:
            'The official client gives you connectivity, not structure. Once ClickHouse powers app features, teams usually need generated types, reusable queries, and typed delivery paths rather than entity mapping.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How hypequery works',
        title: 'Schema-first types and composable queries for ClickHouse',
        description:
          'hypequery introspects your live ClickHouse schema and generates a TypeScript interface for every table and column with the right ClickHouse-to-TypeScript mappings. You then build queries with a fluent builder that stays close to real ClickHouse usage.',
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
          'The query builder uses the generated schema so table names, column names, and result shapes stay typed. Autocomplete works, refactors are safer, and the schema stays in sync by re-running generate.',
        paragraphs: [
          'This is the ORM-like experience for ClickHouse, but without pretending ClickHouse behaves like Postgres.',
          'If you want the fastest proof, generate types from your own schema and write one real query. That will tell you more than another comparison table.',
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
            'The useful part of the ORM promise is simple: types should come from the database, not from your imagination. That is exactly what hypequery gives you for ClickHouse.',
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
          href: '/drizzle-clickhouse',
          title: 'Drizzle ORM for ClickHouse',
          description: 'A dedicated page for teams searching for Drizzle ORM support on ClickHouse and what to use instead.',
        },
        {
          href: '/prisma-clickhouse',
          title: 'Prisma for ClickHouse',
          description: 'A dedicated page for teams searching for Prisma on ClickHouse and the TypeScript-first alternative.',
        },
        {
          href: '/typeorm-clickhouse',
          title: 'TypeORM for ClickHouse',
          description: 'A dedicated page for teams searching for TypeORM on ClickHouse and the TypeScript-first alternative.',
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
        title: 'Generate schema types and start with hypequery on a real ClickHouse query',
        description:
          'Run schema generation against your ClickHouse instance, then build your first typed query. This is the fastest way to prove the ORM-like workflow on your real schema.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-schema', label: 'Generate schema types' },
      }}
    />
  );
}
