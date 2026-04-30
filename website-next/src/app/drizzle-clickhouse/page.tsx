import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Drizzle ORM for ClickHouse — Alternative for TypeScript Teams | hypequery',
  description:
    'Looking for Drizzle ORM support for ClickHouse? Drizzle does not support ClickHouse. hypequery is the TypeScript-first alternative for schema generation and typed queries.',
  alternates: { canonical: absoluteUrl('/drizzle-clickhouse') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/drizzle-clickhouse'),
    title: 'Drizzle ORM for ClickHouse — Alternative for TypeScript Teams | hypequery',
    description:
      'If you want a Drizzle-style workflow for ClickHouse, use hypequery: live-schema generation, composable queries, and typed APIs built for analytics.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Drizzle ORM for ClickHouse | hypequery',
    description:
      'Drizzle does not support ClickHouse. hypequery is the TypeScript-first alternative for ClickHouse analytics applications.',
  },
};

const generateCode = `# introspect your live ClickHouse schema
npx @hypequery/cli generate --output ./src/schema.ts

# generated types match ClickHouse runtime behaviour:
# DateTime -> string
# UInt64   -> string
# Nullable -> T | null`;

const queryCode = `import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
});

const dailySignups = await db
  .table('events')
  .select([selectExpr('toStartOfDay(created_at)', 'day')])
  .distinctCount('user_id', 'signups')
  .where('event_type', 'eq', 'signup')
  .groupBy('day')
  .orderBy('day', 'DESC')
  .execute();`;

export default function DrizzleClickHousePage() {
  return (
    <ClickhousePillarPage
      eyebrow="Drizzle ORM ClickHouse"
      title="Looking for Drizzle ORM on ClickHouse?"
      description="Drizzle does not support ClickHouse. If what you want is the part people actually like about Drizzle — generated types, predictable query code, and a good TypeScript workflow — hypequery is the closer fit for ClickHouse."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/compare/hypequery-vs-drizzle', label: 'Read the full comparison' }}
      stats={[
        { label: 'ClickHouse support', value: 'hypequery native' },
        { label: 'Type source', value: 'Generated from live schema' },
        { label: 'Best fit', value: 'Analytics-heavy TypeScript apps' },
      ]}
      problems={[
        {
          title: 'Drizzle is built around transactional databases',
          copy:
            'Drizzle is excellent for Postgres, MySQL, and SQLite. ClickHouse is columnar, append-optimised, and built for large scans and aggregations rather than row-level relational workflows.',
        },
        {
          title: 'ClickHouse runtime types need their own mapping rules',
          copy:
            'DateTime values come back as strings, UInt64 values come back as strings, and nullable semantics differ from common ORM assumptions. Hand-maintained interfaces drift fast.',
        },
        {
          title: 'Analytics teams usually need more than a query builder',
          copy:
            'Once ClickHouse powers app features, dashboards, or APIs, teams usually need reusable query definitions and a stable delivery path as well as local query composition.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What to use',
        title: 'Use hypequery as the ClickHouse-native TypeScript layer',
        description:
          'hypequery gives you the part of the Drizzle experience that matters for ClickHouse: types that come from the database, fluent queries in TypeScript, and a path to reuse those queries across scripts, APIs, and frontend code.',
        bullets: [
          'Generate TypeScript types from your live ClickHouse schema',
          'Use a composable query builder with ClickHouse-aware helpers and raw SQL escape hatches',
          'Keep runtime types accurate: DateTime, UInt64, Decimal, Nullable',
          'Promote queries into typed REST endpoints and OpenAPI docs when they need to be shared',
          'Use React hooks on top of the same query contract when dashboards need the same data',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Generate types from the real schema',
          description:
            'This is the key difference from generic TypeScript builders. The schema comes from the live ClickHouse database, so the generated types follow actual runtime behaviour rather than relational assumptions.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Write typed ClickHouse queries in application code',
        description:
          'The query builder stays close to SQL where that helps, but it gives you typed table names, typed column names, and reusable query composition in regular TypeScript.',
        paragraphs: [
          'If your team already uses Drizzle for Postgres and is adding ClickHouse for analytics, the clean split is usually Drizzle for transactional data and hypequery for ClickHouse.',
          'That avoids forcing a relational abstraction onto an analytics database while keeping a familiar TypeScript workflow on both sides.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'Query ClickHouse with generated types',
          description:
            'A typical analytics query uses ClickHouse functions, aggregation, and grouping. This is where a ClickHouse-specific builder is more valuable than a generic ORM abstraction.',
          code: queryCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Does Drizzle support ClickHouse?',
          copy:
            'No. Drizzle does not support ClickHouse. If you need a TypeScript-first workflow for ClickHouse, hypequery is the direct alternative.',
        },
        {
          title: 'Drizzle alternative for ClickHouse',
          copy:
            'The closer fit is a schema-generated ClickHouse query layer, not a relational ORM. hypequery gives you generated types, fluent queries, and typed APIs around ClickHouse.',
        },
        {
          title: 'Type-safe ClickHouse queries in TypeScript',
          copy:
            'The practical problem is not ORM branding. It is getting correct runtime types and reusable queries without hand-written interfaces. That is the gap hypequery closes.',
        },
        {
          title: 'Use Drizzle with Postgres and ClickHouse together',
          copy:
            'A common architecture is Drizzle for transactional Postgres data and hypequery for ClickHouse analytics. Each tool stays in the database shape it was built for.',
        },
      ]}
      readingLinks={[
        {
          href: '/compare/hypequery-vs-drizzle',
          title: 'hypequery vs Drizzle',
          description: 'The deeper comparison page covering where the workflows overlap and where ClickHouse changes the shape of the problem.',
        },
        {
          href: '/clickhouse-orm',
          title: 'ClickHouse ORM',
          description: 'The broader page for teams looking for an ORM-like workflow on ClickHouse.',
        },
        {
          href: '/clickhouse-schema',
          title: 'ClickHouse schema generation',
          description: 'See how live-schema introspection becomes TypeScript types that match real ClickHouse runtime values.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse query builder',
          description: 'See the query builder layer in more detail, including filters, aggregations, joins, and raw SQL escape hatches.',
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
        title: 'Generate your ClickHouse schema types and prove the workflow on one real query',
        description:
          'That is the fastest way to evaluate whether hypequery covers the Drizzle-style ClickHouse workflow your team actually wants.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/compare/hypequery-vs-drizzle', label: 'Read full comparison' },
      }}
    />
  );
}
