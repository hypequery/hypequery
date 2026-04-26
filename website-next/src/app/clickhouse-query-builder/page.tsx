import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Query Builder for TypeScript | hypequery',
  description:
    'Build ClickHouse queries in TypeScript with schema-generated types, reusable query definitions, and a practical raw SQL escape hatch when needed.',
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

const multiContextCode = `// same query definition — three execution contexts

// 1. inline execution
const rows = await revenue.execute()

// 2. HTTP endpoint with OpenAPI docs
const app = serve({ queries: { revenue } })
app.listen(3000)

// 3. React hook
const { useRevenue } = createHooks({ revenue })`;

export default function ClickHouseQueryBuilderPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Query Builder"
      title="The TypeScript-first ClickHouse query builder"
      description="Write composable, type-safe ClickHouse queries. Types are generated from your live schema — including correct ClickHouse-to-TypeScript mappings for DateTime, UInt64, Nullable, and Decimal. No SQL strings. No hand-written interfaces."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/blog/clickhouse-query-builder-typescript', label: 'Compare your options' }}
      stats={[
        { label: 'Type source', value: 'Generated from schema' },
        { label: 'ClickHouse syntax', value: 'Native support' },
        { label: 'Best for', value: 'Analytics-heavy TS apps' },
      ]}
      problems={[
        {
          title: 'ClickHouse types do not map cleanly to TypeScript',
          copy:
            'DateTime comes back as a string, not a Date. UInt64 comes back as a string. If you write your own interfaces, you\'re guessing — and TypeScript trusts you. hypequery generates types from the live schema so they\'re always right.',
        },
        {
          title: 'SQL strings do not scale across a codebase',
          copy:
            'The same analytics query ends up duplicated in API routes, background jobs, dashboards, and internal tools. A query builder with composable, reusable definitions removes that drift.',
        },
        {
          title: 'Generic query builders are not built for ClickHouse',
          copy:
            'Tools built for Postgres need adapting for ClickHouse. A ClickHouse-focused layer should at minimum understand the data types, support reusable analytical queries, and provide an honest escape hatch for ClickHouse-specific SQL.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How hypequery works',
        title: 'Generate types from ClickHouse, then build composable queries',
        description:
          'Run npx @hypequery/cli generate against your ClickHouse instance. You get a typed schema file that maps every table and column to the correct TypeScript type. Then build queries with a fluent builder that understands ClickHouse natively.',
        bullets: [
          'Schema types generated from your live ClickHouse database',
          'Correct runtime type mappings — DateTime→string, UInt64→string, Nullable→T|null',
          'Composable builder with conditional filters and reusable query fragments',
          'Typed query composition, CTE helpers, and raw SQL escape hatches where needed',
          'Same query definition runs inline, over HTTP, or as a React hook',
        ],
        codePanel: {
          eyebrow: 'Query builder',
          title: 'Typed queries from generated schema',
          description:
            'Types come from the schema, not from hand-written interfaces. When the schema changes and you regenerate, TypeScript catches the mismatch at compile time.',
          code: builderCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Multi-context execution',
        title: 'Define once, execute in any context',
        description:
          'The query builder is one part of hypequery. The same query definition that runs inline can also be served as an HTTP endpoint with OpenAPI docs, or wrapped in a typed React hook — without rewriting anything.',
        paragraphs: [
          'This is the core difference between a query builder and an analytics layer. A query builder helps you write queries. An analytics layer makes those queries reusable across your entire product.',
          'If you are comparing options, the blog post walks through @clickhouse/client, Kysely, Cube, and hypequery side by side.',
        ],
        codePanel: {
          eyebrow: 'Multi-context',
          title: 'One query definition, three execution contexts',
          description:
            'Define it once. Run it inline for scripts and tests, serve it over HTTP for dashboards, or wrap it in a React hook for interactive components.',
          code: multiContextCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse query builder TypeScript',
          copy:
            'The useful distinction is not fluent syntax alone. It is whether the builder understands ClickHouse return types, keeps query definitions reusable, and stays honest about when raw SQL is still the right tool.',
        },
        {
          title: 'Type-safe ClickHouse queries',
          copy:
            'Type safety in ClickHouse starts with getting the mappings right. DateTime, UInt64, Decimal, and Nullable columns all behave differently from what TypeScript might assume. Generated schema types fix this at the source.',
        },
        {
          title: 'ClickHouse vs Kysely',
          copy:
            'Kysely is excellent for Postgres. For ClickHouse-primary analytics, the lack of native ClickHouse syntax and schema introspection means you\'ll be working around its edges. See the full comparison in the blog post.',
        },
        {
          title: 'ClickHouse HTTP API TypeScript',
          copy:
            'If you want a typed HTTP layer on top of ClickHouse without rebuilding request validation and response schemas yourself, @hypequery/serve turns named query definitions into documented endpoints.',
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
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Start with schema generation',
        description:
          'Generate TypeScript types from your live ClickHouse schema. Then build your first typed query, and decide whether to run it inline or expose it over HTTP.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/docs/schemas', label: 'Read the schemas guide' },
      }}
    />
  );
}
