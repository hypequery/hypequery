import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Cube.js Alternative for ClickHouse — Code-First TypeScript Layer',
  description:
    'Looking for a Cube.js alternative for ClickHouse? hypequery replaces the Cube server, Redis cache, and YAML modelling with a typed TypeScript library that lives in your codebase.',
  alternates: { canonical: absoluteUrl('/cube-js-alternative') },
  openGraph: {
    images: ogImage('Cube.js Alternative for ClickHouse — Code-First TypeScript Layer'),
    type: 'website',
    url: absoluteUrl('/cube-js-alternative'),
    title: 'Cube.js Alternative for ClickHouse — Code-First TypeScript Layer | hypequery',
    description:
      'If Cube feels like too much infrastructure for a ClickHouse-backed product, hypequery gives you typed queries, APIs, and React hooks with no separate server to run.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cube.js Alternative for ClickHouse | hypequery',
    description:
      'Replace the Cube server, cache layer, and YAML schema with a typed TypeScript library built for ClickHouse.',
  },
};

const generateCode = `# introspect your live ClickHouse schema
npx @hypequery/cli generate --output ./src/schema.ts

# no Cube server, no Redis, no deployment to manage
# your "semantic layer" is TypeScript in your own repo`;

const queryCode = `import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
});

// what a Cube "measure + dimension" becomes: a typed query
const revenueByDay = await db
  .table('orders')
  .select([selectExpr('toStartOfDay(created_at)', 'day')])
  .sum('amount', 'revenue')
  .where('status', 'eq', 'completed')
  .groupBy('day')
  .orderBy('day', 'DESC')
  .execute();`;

export default function CubeJsAlternativePage() {
  return (
    <ClickhousePillarPage
      eyebrow="Cube.js Alternative"
      title="Looking for a Cube.js alternative for ClickHouse?"
      description="Cube is good at what it does. It's also a lot: a server to deploy, a cache layer to run, and a modelling language to learn. If you're a TypeScript team shipping ClickHouse-backed product features, hypequery covers the part you actually use — typed queries, typed APIs, and React hooks — as a plain library in your own repo."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/compare/hypequery-vs-cube', label: 'Read the full comparison' }}
      stats={[
        { label: 'Infrastructure', value: 'None — npm library' },
        { label: 'Modelling', value: 'TypeScript, not YAML' },
        { label: 'Best fit', value: 'ClickHouse-backed product features' },
      ]}
      problems={[
        {
          title: 'Cube is a platform you have to operate',
          copy:
            'A production Cube deployment means the Cube API server, a Cube Store or Redis cache layer, and schema config deployed alongside both. That is a lot of operational surface when what you actually have is a handful of product queries.',
        },
        {
          title: 'The data model lives outside your application',
          copy:
            'Cubes, measures, and dimensions sit in YAML or JS config, in a separate modelling layer. Your app then talks to them through Cube-specific query JSON — one more contract to keep in sync with the code that actually uses the data.',
        },
        {
          title: 'TypeScript is a second-class consumer',
          copy:
            'Cube serves REST, GraphQL, and SQL APIs, but none of the response types come from your ClickHouse schema. So teams hand-maintain interfaces for Cube responses — which is the exact drift problem a semantic layer was supposed to fix.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The alternative',
        title: 'A code-first typed layer instead of a semantic layer platform',
        description:
          'hypequery replaces the Cube server with a library. Types come from your live ClickHouse schema, queries are TypeScript, and serving them as APIs is one function call — no separate deployment, cache cluster, or modelling language.',
        bullets: [
          'Generate TypeScript types from your live ClickHouse schema — no YAML modelling layer',
          'Define metrics as typed, composable query builder code in your own repo',
          'Serve queries as REST endpoints with validation and OpenAPI docs via @hypequery/serve',
          'Consume the same typed contracts in React with generated hooks',
          'Ship it like any other code change — no Cube deployment to coordinate',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Generate types instead of modelling cubes',
          description:
            'Your ClickHouse schema is already the data model. hypequery introspects it and generates types that match runtime behaviour, so there’s no second modelling layer to maintain.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Metrics become typed queries in your codebase',
        description:
          'What Cube expresses as measures and dimensions in config, hypequery expresses as query builder code — reviewable in PRs, refactorable with your editor, and type-checked against the real schema.',
        paragraphs: [
          'Worth saying plainly: Cube is still the right call if you need BI tool connectivity (Tableau, Metabase, Superset over its SQL API), pre-aggregations feeding many consumers, or one metrics layer across several databases. hypequery is ClickHouse-only and application-first, on purpose.',
          'But if your Cube deployment exists to power your own product dashboards and APIs on ClickHouse, a typed library is less to run, less to learn, and closer to your code.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'A measure, without the modelling layer',
          description:
            'Aggregations, time bucketing, and filters are typed against your generated schema. Runtime parameters like date ranges and tenant IDs are ordinary function arguments.',
          code: queryCode,
        },
      }}
      comparisonTable={{
        eyebrow: 'Side by side',
        title: 'Cube vs hypequery at a glance',
        description:
          'The short version: Cube is a platform between your databases and many consumers. hypequery is a library between your ClickHouse and your application.',
        competitorLabel: 'Cube',
        rows: [
          {
            label: 'Runs as',
            competitor: 'Separate API server plus Cube Store or Redis cache',
            hypequery: 'A library inside your existing Node.js app',
          },
          {
            label: 'Data modelling',
            competitor: 'Cubes, measures, and dimensions in YAML or JS config',
            hypequery: 'TypeScript query code, checked against your real schema',
          },
          {
            label: 'Response types',
            competitor: 'Hand-written interfaces for Cube query responses',
            hypequery: 'Generated from your live ClickHouse schema',
          },
          {
            label: 'Databases',
            competitor: 'Many — Postgres, BigQuery, Snowflake, ClickHouse, more',
            hypequery: 'ClickHouse only, by design',
          },
          {
            label: 'BI tool access',
            competitor: 'SQL API for Tableau, Metabase, Superset',
            hypequery: 'Not a goal — typed application APIs instead',
          },
          {
            label: 'Caching',
            competitor: 'Pre-aggregations and caching built in',
            hypequery: 'Bring your own, or use ClickHouse materialized views',
          },
          {
            label: 'Shipping a change',
            competitor: 'Update schema config, redeploy the Cube service',
            hypequery: 'Normal pull request in your app repo',
          },
          {
            label: 'Cost',
            competitor: 'Open source, with Cube Cloud as the managed option',
            hypequery: 'Free and open source',
          },
        ],
        footnote:
          'If the left column reads like a list of things you rely on — multiple databases, BI consumers, heavy pre-aggregation — stay with Cube. This page is for teams who noticed they only use the right column.',
      }}
      searchIntentCards={[
        {
          title: 'Open source Cube.js alternative',
          copy:
            'hypequery is free and open source. Nothing is gated behind a hosted tier — the query builder, serving layer, OpenAPI generation, and React hooks are all in the packages.',
        },
        {
          title: 'Cube.js alternative without extra infrastructure',
          copy:
            'The most common reason teams go looking for an alternative is operational weight. hypequery has no server component: it runs inside your existing Node.js application and talks straight to ClickHouse.',
        },
        {
          title: 'Semantic layer for ClickHouse in TypeScript',
          copy:
            'If your metric definitions should live in TypeScript next to the code that uses them — with compile-time checking against the real schema — that’s the workflow hypequery is built around.',
        },
        {
          title: 'When Cube is still the right answer',
          copy:
            'Multiple databases, BI tool consumers, or heavy pre-aggregation needs are Cube territory. hypequery deliberately trades that breadth for a lighter, ClickHouse-native developer experience.',
        },
      ]}
      readingLinks={[
        {
          href: '/compare/hypequery-vs-cube',
          title: 'hypequery vs Cube',
          description: 'The full comparison covering setup, workflow, and where each tool is the right choice.',
        },
        {
          href: '/clickhouse-semantic-layer',
          title: 'ClickHouse semantic layer',
          description: 'How a code-first semantic layer works when ClickHouse is the only database that matters.',
        },
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'How @hypequery/serve turns query definitions into validated, documented endpoints.',
        },
        {
          href: '/clickhouse-react',
          title: 'ClickHouse React hooks',
          description: 'Consume the same typed query contracts from dashboards and product UI.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse Semantic Layer' },
        { href: '/tinybird-alternative', label: 'Tinybird Alternative' },
        { href: '/moosestack-alternative', label: 'MooseStack Alternative' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Test the lighter path against one real metric',
        description:
          'Generate types from your ClickHouse schema and rebuild one Cube measure as a typed query. That’s the fastest way to see whether you need the platform or just the layer.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/compare/hypequery-vs-cube', label: 'Read full comparison' },
      }}
    />
  );
}
