import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse JS — JavaScript & TypeScript Query Builder | hypequery',
  description:
    'Use ClickHouse from JavaScript without living on raw query strings, hand-written row types, and repeated response parsing.',
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

export default function ClickHouseJSPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse JS"
      title="The JavaScript query builder built for ClickHouse"
      description="This page is for teams starting from plain JavaScript or TypeScript and wondering how far the raw ClickHouse client really gets them. hypequery keeps the connection layer, but adds schema-driven query code so the rest of the app is not built on casts and copied SQL."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/compare/hypequery-vs-clickhouse-client', label: 'Compare vs @clickhouse/client' }}
      stats={[
        { label: 'Language', value: 'JavaScript & TypeScript' },
        { label: 'Type source', value: 'Generated from schema' },
        { label: 'Best for', value: 'Analytics-heavy JS apps' },
      ]}
      problems={[
        {
          title: 'The raw client stops at query execution',
          copy:
            'It connects to ClickHouse and runs SQL well. The problem starts after that, when every caller has to decide what the rows look like and how much parsing or casting it wants to do.',
        },
        {
          title: 'JavaScript callers keep re-solving the same runtime type issues',
          copy:
            'DateTime, UInt64, Nullable, and Decimal do not map the way many teams expect. Without a shared type source, every query callsite ends up making its own assumptions.',
        },
        {
          title: 'The same query logic leaks into every runtime',
          copy:
            'A JavaScript stack often spans scripts, server code, and UI consumers. If the query only exists as a string plus an informal row shape, reuse turns into copy-paste very quickly.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What changes',
        title: 'Keep the JavaScript runtime, replace the fragile query layer',
        description:
          'The useful move is not adopting a whole new stack. It is generating a schema file from ClickHouse and using that as the basis for query code, so JavaScript callers stop inventing row types ad hoc.',
        bullets: [
          'Schema types generated from your live ClickHouse database',
          'Correct JS runtime type mappings — DateTime→string, UInt64→string, Nullable→T|null',
          'Composable builder with filters, groupBy, orderBy, and aggregations',
          'Composable builder plus raw SQL escape hatches for ClickHouse-specific clauses',
          'Works across Node.js, Next.js, Bun, and other JavaScript runtimes',
        ],
        codePanel: {
          eyebrow: 'Before vs after',
          title: 'From raw client rows to schema-aware query results',
          description:
            'The important difference is not style. It is that the second version has a real type source instead of leaving every caller to cast the result however it likes.',
          code: `${rawClientCode}\n\n// ---\n\n${hypequerCode}`,
        },
      }}
      implementationSection={{
        eyebrow: 'When a query becomes shared',
        title: 'Move useful queries into named definitions',
        description:
          'Once a JavaScript query stops being local implementation detail, it should stop living as an unstructured string. Promote it into a named definition and let the rest of the stack consume that definition instead.',
        paragraphs: [
          'That is the practical difference between this page and the raw-client story. The client gives you transport. The named query layer gives you something the rest of the product can safely call.',
          'If you are evaluating the tradeoffs, the comparison page spells out where @clickhouse/client stays the simpler option and where it starts leaving too much work to application code.',
        ],
        codePanel: {
          eyebrow: 'Named query',
          title: 'A reusable query definition instead of another raw string',
          description:
            'This is the step that makes the JavaScript story scale. The query stops being “whatever this file does” and becomes something the rest of the app can depend on.',
          code: serveCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What this page is really comparing',
          copy:
            'It is less about official client versus unofficial client, and more about whether query code stays raw and local or becomes typed and reusable.',
        },
        {
          title: 'Where JavaScript teams usually get stuck',
          copy:
            'Usually not on connecting to ClickHouse. Usually on keeping row shapes, response parsing, and copied SQL under control once the codebase grows a few consumers.',
        },
        {
          title: 'Why the type source matters',
          copy:
            'If the query layer starts from the wrong assumptions about DateTime or UInt64, every higher-level abstraction inherits the mistake.',
        },
        {
          title: 'Where to branch next',
          copy:
            'Use the Node.js page for server and job concerns, Next.js for App Router concerns, and React for browser consumption.',
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
        title: 'Replace one raw query in a JavaScript runtime you already own',
        description:
          'Pick a query that currently returns untyped rows, generate the schema, and move that query onto the builder. That is enough to see whether the workflow earns its place.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/docs/schemas', label: 'Read the schemas guide' },
      }}
    />
  );
}
