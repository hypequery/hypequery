import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Query Builder for TypeScript | hypequery',
  description:
    'Build ClickHouse queries in TypeScript with schema-generated types, native ClickHouse syntax, and a clean path from one-off queries to reusable API definitions.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-query-builder'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-query-builder'),
    title: 'ClickHouse Query Builder for TypeScript | hypequery',
    description:
      'Build composable, type-safe ClickHouse queries. Types generated from your live schema — including correct ClickHouse-to-TypeScript mappings.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Query Builder for TypeScript | hypequery',
    description:
      'Build composable, type-safe ClickHouse queries. Types generated from your live schema — including correct ClickHouse-to-TypeScript mappings.',
  },
};

const builderCode = `// types generated from your live ClickHouse schema
import type { DB } from "./generated-schema"

const rows = await db
  .table("orders")
  .select("total_revenue", "order_date")
  .where("status", "=", "completed")
  .where("tenant_id", "=", tenantId)
  .groupBy("order_date")
  .orderBy("order_date", "DESC")
  .execute()

// rows: { total_revenue: string; order_date: string }[]
// correct — matches what ClickHouse actually returns`;

const serveCode = `import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { query, serve } = initServe({
  context: () => ({ db }),
});

const revenueByDay = query({
  input: z.object({
    tenantId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .where('tenant_id', 'eq', input.tenantId)
      .where('order_date', 'gte', input.startDate)
      .where('order_date', 'lte', input.endDate)
      .groupBy(['order_date'])
      .sum('total', 'revenue')
      .execute(),
});

export const api = serve({
  queries: { revenueByDay },
});`;

export default function ClickHouseQueryBuilderPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Query Builder"
      title="The TypeScript-first ClickHouse query builder"
      description="This page is about writing the query itself: selecting columns, filtering, grouping, and composing something you can keep in a real codebase. hypequery gives you typed schema access and native ClickHouse ergonomics without forcing everything through raw SQL strings."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/blog/clickhouse-query-builder-typescript', label: 'Compare your options' }}
      stats={[
        { label: 'Type source', value: 'Generated from schema' },
        { label: 'ClickHouse syntax', value: 'Native support' },
        { label: 'Best for', value: 'Analytics-heavy TS apps' },
      ]}
      problems={[
        {
          title: 'Hand-written result types drift fast',
          copy:
            'If you build queries with raw strings and cast the result afterwards, you end up maintaining a second version of the schema in TypeScript. That breaks the moment a column changes or a query shape evolves.',
        },
        {
          title: 'Most general-purpose builders are shaped around Postgres',
          copy:
            'ClickHouse query code tends to lean on date bucketing, aggregates, CTEs, and engine-specific syntax. A builder that treats ClickHouse as an edge case turns normal analytics work into workaround-heavy code.',
        },
        {
          title: 'Teams still need a way out when SQL is the right tool',
          copy:
            'A good ClickHouse builder should cover the common path well and stay honest about the rest. You do not want a fake abstraction that makes basic queries pleasant but blocks real ClickHouse work.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What the builder gives you',
        title: 'Start from the real schema, then write normal ClickHouse query code',
        description:
          'Run schema generation once, point the query builder at the generated type, and then write queries against real table and column names. That is the useful part: less casting, better autocomplete, and fewer mistakes when a query gets edited six months later.',
        bullets: [
          'Schema types generated from your live ClickHouse database',
          'Column names and return shapes inferred from that schema',
          'A fluent builder for the common path: filters, grouping, ordering, aggregates',
          'Helpers for composing query fragments instead of copying strings between files',
          'Raw SQL escape hatches for the parts ClickHouse specialists actually need',
        ],
        codePanel: {
          eyebrow: 'Builder example',
          title: 'A typed query without post-query casting',
          description:
            'The important part is not the fluent syntax. It is that the builder knows the schema it is operating on, so table names, columns, and result shapes stay aligned with the database.',
          code: builderCode,
        },
      }}
      implementationSection={{
        eyebrow: 'When the query stops being local',
        title: 'Promote a useful query into a named API definition',
        description:
          'This is where the page should stay concrete: the query builder helps you author and test the query. If that same query later needs to power a dashboard or internal API, move it into a named definition with `initServe()` rather than rewriting it in a route file.',
        paragraphs: [
          'That is the boundary between this page and the broader analytics pages. Start here if you are replacing raw query strings. Move to the REST or React pages only when the query needs consumers outside the current process.',
          'If you are comparing libraries, the companion article walks through @clickhouse/client, Kysely, Cube, and hypequery with the tradeoffs spelled out.',
        ],
        codePanel: {
          eyebrow: 'Serve example',
          title: 'Turn a working query into a reusable endpoint',
          description:
            'The query-builder page should not pretend everything is a React hook immediately. The natural next step is usually a named query that can be served and reused.',
          code: serveCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What makes a ClickHouse builder useful',
          copy:
            'Fluent syntax alone is not enough. The builder has to understand ClickHouse return types, stay out of the way on aggregates and grouping, and avoid forcing a relational model onto analytics queries.',
        },
        {
          title: 'Where raw SQL still wins',
          copy:
            'Some queries are clearer as SQL, especially when you are leaning on more advanced ClickHouse features. A good builder should let you drop down deliberately instead of pretending that never happens.',
        },
        {
          title: 'How this differs from Kysely',
          copy:
            'Kysely is excellent in relational stacks. This page is for teams whose center of gravity is ClickHouse analytics, where schema introspection and ClickHouse-native query patterns matter more than SQL portability.',
        },
        {
          title: 'When to leave this page',
          copy:
            'If your next problem is HTTP delivery, not query authoring, jump to the REST API page. If your problem is browser consumers, jump to the React or Next.js pages.',
        },
      ]}
      readingLinks={[
        {
          href: '/blog/clickhouse-query-builder-typescript',
          title: 'ClickHouse query builders compared',
          description: 'Every realistic option in 2026 — raw client, Kysely, Cube, and hypequery — with honest tradeoffs.',
        },
        {
          href: '/blog/clickhouse-typescript-type-problem',
          title: 'The ClickHouse TypeScript type problem',
          description: 'Why DateTime, UInt64, Nullable, and Decimal all return the wrong types and how to fix it.',
        },
        {
          href: '/compare/hypequery-vs-clickhouse-client',
          title: 'hypequery vs @clickhouse/client',
          description: 'What you actually gain when you move from raw queries to generated types and a reusable query layer.',
        },
        {
          href: '/compare/hypequery-vs-kysely',
          title: 'hypequery vs Kysely',
          description: 'Where Kysely is excellent, where ClickHouse changes the tradeoffs, and when hypequery is the better fit.',
        },
        {
          href: '/drizzle-clickhouse',
          title: 'Drizzle ORM for ClickHouse',
          description: 'A dedicated landing page for the Drizzle-on-ClickHouse search intent and the closest alternative.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Write one real query against your schema',
        description:
          'Generate the schema file, point the builder at it, and replace one raw query in your codebase. That is the fastest way to tell whether the workflow fits how your team actually writes ClickHouse code.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/docs/schemas', label: 'Read the schemas guide' },
      }}
    />
  );
}
