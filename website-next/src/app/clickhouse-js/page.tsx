import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse JS — JavaScript & TypeScript Query Builder | hypequery',
  description:
    'Stop writing raw SQL strings for ClickHouse in JavaScript. hypequery gives you schema-generated types, a composable query builder, and typed HTTP APIs. Free and open source.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-js'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-js'),
    title: 'ClickHouse JS — JavaScript & TypeScript Query Builder | hypequery',
    description:
      'The JavaScript and TypeScript query builder built specifically for ClickHouse. Generated schema types, composable queries, HTTP API, and React hooks.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse JS — JavaScript & TypeScript Query Builder | hypequery',
    description:
      'Stop writing raw SQL strings for ClickHouse in JavaScript. hypequery gives you schema-generated types, a composable query builder, and typed HTTP APIs.',
  },
};

const rawClientCode = `// @clickhouse/client — what most teams start with
const result = await client.query({
  query: \`SELECT order_date, sum(total) as revenue
          FROM orders
          WHERE tenant_id = {tenant_id: String}
          GROUP BY order_date\`,
  query_params: { tenant_id: ctx.tenantId },
})

const rows = await result.json()
// rows: { data: any[] } — no types, no safety`;

const hypequerCode = `// hypequery — generated from your ClickHouse schema
const rows = await db
  .table('orders')
  .select('order_date', 'revenue')
  .where('tenant_id', 'eq', ctx.tenantId)
  .groupBy('order_date')
  .orderBy('order_date', 'DESC')
  .execute()

// rows: { order_date: string; revenue: string }[]
// correct ClickHouse-to-JS type mappings, always`;

const multiContextCode = `// define your query once in JavaScript or TypeScript
const revenueByDay = query({
  input: z.object({ tenantId: z.string() }),
  query: async ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .where('tenant_id', 'eq', input.tenantId)
      .groupBy(['order_date'])
      .sum('total', 'revenue')
      .execute(),
});

// 1. run inline — scripts, jobs, tests
const rows = await revenueByDay.execute({ tenantId: 'acme' });

// 2. serve over HTTP with OpenAPI docs
const app = serve({ queries: { revenueByDay } });
app.listen(3000);

// 3. wrap as a typed React hook
const { useRevenueByDay } = createHooks({ revenueByDay });`;

export default function ClickHouseJSPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse JS"
      title="The JavaScript query builder built for ClickHouse"
      description="@clickhouse/client gives you a connection. hypequery gives you a full JavaScript analytics layer — schema-generated types, a composable query builder, typed HTTP APIs, and React hooks. Built specifically for ClickHouse, not adapted from a Postgres tool."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started free' }}
      secondaryCta={{ href: '/compare/hypequery-vs-clickhouse-client', label: 'Compare vs @clickhouse/client' }}
      stats={[
        { label: 'Language', value: 'JavaScript & TypeScript' },
        { label: 'Type source', value: 'Generated from schema' },
        { label: 'Best for', value: 'Analytics-heavy JS apps' },
      ]}
      problems={[
        {
          title: '@clickhouse/client returns any — no type safety',
          copy:
            'The official ClickHouse JS client executes queries and returns untyped results. Every response is effectively `any`. You hand-write interfaces that drift from the real schema, and TypeScript cannot catch the mismatch.',
        },
        {
          title: 'ClickHouse types do not map to JavaScript cleanly',
          copy:
            'DateTime columns come back as strings, not Date objects. UInt64 values come back as strings to avoid precision loss. Nullable columns return null. If you are guessing the mappings, you are introducing silent bugs.',
        },
        {
          title: 'Raw SQL strings do not scale in a JavaScript codebase',
          copy:
            'The same analytics query gets copy-pasted into API routes, background jobs, dashboards, and internal tools. When the schema changes, you find and fix it everywhere — or miss one and ship a bug.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How hypequery works',
        title: 'Generate types from ClickHouse, then build composable queries in JS',
        description:
          'Run `npx @hypequery/cli generate` against your ClickHouse instance. You get a typed schema file that maps every table and column to the correct JavaScript type. Then use the query builder to write composable, reusable analytics queries without touching a SQL string.',
        bullets: [
          'Schema types generated from your live ClickHouse database',
          'Correct JS runtime type mappings — DateTime→string, UInt64→string, Nullable→T|null',
          'Composable builder with filters, groupBy, orderBy, and aggregations',
          'Composable builder plus raw SQL escape hatches for ClickHouse-specific clauses',
          'Works in Node.js, Next.js, Bun, and any JS runtime that supports fetch',
        ],
        codePanel: {
          eyebrow: 'Before vs after',
          title: 'From raw @clickhouse/client to typed hypequery',
          description:
            'The raw client returns untyped results. hypequery returns results typed from your generated schema — correct ClickHouse-to-JavaScript mappings included.',
          code: `${rawClientCode}\n\n// ---\n\n${hypequerCode}`,
        },
      }}
      implementationSection={{
        eyebrow: 'Multi-context execution',
        title: 'Define once, run anywhere in your JS stack',
        description:
          'hypequery is not just a query builder. The same query definition that runs inline can be served as an HTTP endpoint with OpenAPI docs, or wrapped as a typed React hook — without duplicating logic.',
        paragraphs: [
          'This is the difference between a ClickHouse JS client and a ClickHouse JS analytics layer. A client runs queries. An analytics layer makes those queries reusable, typed, and composable across your entire JavaScript product.',
          'If you are evaluating your options, read the full comparison of @clickhouse/client, Kysely, Cube, and hypequery side by side.',
        ],
        codePanel: {
          eyebrow: 'Multi-context',
          title: 'One query, three execution contexts',
          description:
            'Define your analytics query once in JavaScript or TypeScript. Run it inline, serve it over HTTP, or use it as a React hook — the same definition, zero duplication.',
          code: multiContextCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse JavaScript client',
          copy:
            '@clickhouse/client is the official option — but it returns untyped results and requires you to hand-write interfaces. hypequery wraps your ClickHouse connection with generated types and a composable query builder on top.',
        },
        {
          title: 'ClickHouse Node.js query builder',
          copy:
            'Most query builders are built for Postgres and adapted for ClickHouse. hypequery is built specifically for ClickHouse workloads, with typed query composition and room to drop to raw SQL when a ClickHouse-specific clause is needed.',
        },
        {
          title: 'ClickHouse JS types — DateTime, UInt64, Nullable',
          copy:
            'The ClickHouse-to-JavaScript type mapping is where most teams hit silent bugs. DateTime returns as a string. UInt64 returns as a string. hypequery generates these mappings from your live schema so you never guess.',
        },
        {
          title: 'ClickHouse HTTP API in JavaScript',
          copy:
            'If you want a typed HTTP API on top of ClickHouse without hand-writing each route, @hypequery/serve exposes your query definitions as HTTP endpoints with full OpenAPI docs automatically.',
        },
      ]}
      readingLinks={[
        {
          href: '/compare/hypequery-vs-clickhouse-client',
          title: 'hypequery vs @clickhouse/client',
          description: 'What you actually gain when you move from raw queries to generated types and a reusable JS analytics layer.',
        },
        {
          href: '/blog/clickhouse-query-builder-typescript',
          title: 'ClickHouse query builders compared',
          description: 'Every realistic JavaScript and TypeScript option in 2026 — with honest tradeoffs on each.',
        },
        {
          href: '/blog/clickhouse-typescript-type-problem',
          title: 'The ClickHouse TypeScript type problem',
          description: 'Why DateTime, UInt64, Nullable, and Decimal return the wrong types in JavaScript and how to fix it.',
        },
        {
          href: '/compare/hypequery-vs-kysely',
          title: 'hypequery vs Kysely',
          description: 'Where Kysely is excellent, where ClickHouse changes the tradeoffs, and when hypequery is the better fit.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Add hypequery to your JavaScript project',
        description:
          'Install the package, run schema generation against your ClickHouse instance, and write your first typed query in under five minutes.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/docs/schemas', label: 'Read the schemas guide' },
      }}
    />
  );
}
