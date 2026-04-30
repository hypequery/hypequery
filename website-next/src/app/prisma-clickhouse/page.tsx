import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Prisma for ClickHouse: What TypeScript Teams Should Use Instead | hypequery',
  description:
    'Prisma does not support ClickHouse. If you need a schema-first TypeScript workflow for ClickHouse, use hypequery for generated types and composable queries.',
  alternates: { canonical: absoluteUrl('/prisma-clickhouse') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/prisma-clickhouse'),
    title: 'Prisma for ClickHouse: What TypeScript Teams Should Use Instead | hypequery',
    description:
      'Prisma is built for relational transactional databases. If you need a TypeScript-first workflow for ClickHouse analytics, hypequery is the closer fit.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Prisma for ClickHouse | hypequery',
    description:
      'Prisma does not support ClickHouse. Use hypequery for generated schema types, composable ClickHouse queries, and reusable APIs.',
  },
};

const generateCode = `# introspect your live ClickHouse schema
npx @hypequery/cli generate --output ./src/schema.ts

# generated types follow ClickHouse runtime behaviour:
# DateTime -> string
# UInt64   -> string
# Nullable -> T | null`;

const queryCode = `import { createQueryBuilder, rawAs, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
});

const revenueByMonth = await db
  .table('orders')
  .select([
    selectExpr('toStartOfMonth(created_at)', 'month'),
    rawAs('sum(total)', 'revenue'),
  ])
  .where('status', 'eq', 'completed')
  .groupBy('month')
  .orderBy('month', 'ASC')
  .execute();`;

export default function PrismaClickHousePage() {
  return (
    <ClickhousePillarPage
      eyebrow="Prisma ClickHouse"
      title="Looking for Prisma on ClickHouse?"
      description="Prisma does not support ClickHouse. If what you actually want is the useful part of the Prisma experience — generated types, predictable query code, and a clean TypeScript workflow — hypequery is the closer fit for ClickHouse."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-orm', label: 'See the ClickHouse ORM page' }}
      stats={[
        { label: 'Prisma fit', value: 'Relational app databases' },
        { label: 'hypequery fit', value: 'ClickHouse analytics workloads' },
        { label: 'Type source', value: 'Generated from live schema' },
      ]}
      problems={[
        {
          title: 'Prisma models a relational world that ClickHouse does not implement',
          copy:
            'Prisma is excellent when your data model is tables, relations, and transactional writes. ClickHouse is a columnar analytics database optimized for append-heavy workloads, large scans, and aggregation.',
        },
        {
          title: 'ClickHouse runtime values break normal ORM expectations',
          copy:
            'DateTime values come back as strings, UInt64 values come back as strings, and ClickHouse-specific functions and clauses are part of normal analytics work. Those are not natural Prisma abstractions.',
        },
        {
          title: 'Most teams searching for Prisma on ClickHouse really want a schema-first TypeScript workflow',
          copy:
            'The practical need is generated types, safe query composition, and a reusable delivery path across APIs, jobs, and dashboards. That is the gap hypequery closes for ClickHouse teams.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What to use',
        title: 'Use hypequery as the schema-first TypeScript layer for ClickHouse',
        description:
          'hypequery gives you the part of the Prisma experience that matters for ClickHouse: types generated from the real database, fluent query composition in TypeScript, and a way to reuse those queries across your stack.',
        bullets: [
          'Generate TypeScript types from your live ClickHouse schema',
          'Use a composable query builder built for ClickHouse analytics queries',
          'Keep runtime type mappings accurate: DateTime, UInt64, Decimal, Nullable',
          'Promote queries into typed REST endpoints and OpenAPI docs when teams need shared delivery',
          'Use the same contract across backend code, dashboards, and internal tooling',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Generate types from the real schema',
          description:
            'This keeps TypeScript aligned with actual ClickHouse runtime behaviour instead of pretending the database behaves like Prisma’s supported engines.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Write typed ClickHouse queries instead of relational ORM code',
        description:
          'ClickHouse applications usually want query composition, aggregations, and reusable delivery paths rather than relation loading or transactional unit-of-work patterns. hypequery stays close to that shape.',
        paragraphs: [
          'If your stack already uses Prisma with Postgres, the clean split is often Prisma for transactional application data and hypequery for ClickHouse analytics.',
          'That keeps each tool aligned to the database shape it was built for instead of asking a relational ORM to cover an analytics database it does not support.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'Query ClickHouse with generated types',
          description:
            'A realistic ClickHouse query usually looks more like analytics SQL than relational ORM code. This is where a ClickHouse-specific TypeScript layer is more useful than generic ORM expectations.',
          code: queryCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Does Prisma support ClickHouse?',
          copy:
            'No. Prisma does not support ClickHouse. If you need a schema-first TypeScript workflow for ClickHouse analytics, hypequery is the direct alternative.',
        },
        {
          title: 'Prisma alternative for ClickHouse',
          copy:
            'The better fit is a schema-generated ClickHouse query layer rather than a relational ORM. hypequery gives you generated types, fluent queries, and typed APIs on top of ClickHouse.',
        },
        {
          title: 'ORM for ClickHouse',
          copy:
            'The practical need is usually type-safe queries and reusable delivery paths, not relations and transactions. That is the gap hypequery closes for ClickHouse teams.',
        },
        {
          title: 'Use Prisma with Postgres and ClickHouse together',
          copy:
            'A common architecture is Prisma for transactional Postgres data and hypequery for ClickHouse analytics. Each tool stays inside the workload shape it was designed for.',
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
          description: 'Another dedicated unsupported-ORM intent page aimed at teams coming from Drizzle.',
        },
        {
          href: '/typeorm-clickhouse',
          title: 'TypeORM for ClickHouse',
          description: 'The same unsupported-ORM intent pattern for teams coming from TypeORM.',
        },
        {
          href: '/clickhouse-schema',
          title: 'ClickHouse schema generation',
          description: 'See how live-schema introspection becomes TypeScript types that match real ClickHouse runtime values.',
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
        title: 'Start with hypequery on one real ClickHouse query',
        description:
          'Generate schema types from your ClickHouse instance and try one real analytics query. That is the fastest way to validate whether the Prisma-style ClickHouse workflow you want is really a generated-schema query-layer problem instead.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-schema', label: 'Generate schema types' },
      }}
    />
  );
}
