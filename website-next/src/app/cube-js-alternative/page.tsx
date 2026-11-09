import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Cube.js Alternative for ClickHouse (2026)',
  description:
    'A Cube.js alternative for ClickHouse with no Cube server, Cube Store cluster, or YAML: hypequery is a TypeScript or Python library that lives in your codebase.',
  alternates: { canonical: absoluteUrl('/cube-js-alternative') },
  openGraph: {
    images: ogImage('Cube.js Alternative for ClickHouse — A Code-First Semantic Layer'),
    type: 'website',
    url: absoluteUrl('/cube-js-alternative'),
    title: 'Cube.js Alternative for ClickHouse — A Code-First Semantic Layer | hypequery',
    description:
      'If Cube feels like too much infrastructure for a ClickHouse-backed product, hypequery gives you typed queries, APIs, and React hooks with no separate server to run.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cube.js Alternative for ClickHouse | hypequery',
    description:
      'Replace the Cube server, cache layer, and YAML schema with a TypeScript or Python library built for ClickHouse.',
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
      description="Cube is good at what it does. It's also a lot: a server to deploy, a cache layer to run, and a modelling language to learn. If you're shipping ClickHouse-backed product features, hypequery covers the part you actually use — typed datasets, APIs, React hooks, and MCP tools — as code in your own repo, in TypeScript or Python."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/compare/hypequery-vs-cube', label: 'Read the full comparison' }}
      stats={[
        { label: 'Infrastructure', value: 'None — npm or PyPI library' },
        { label: 'Modelling', value: 'TypeScript or Python, not YAML' },
        { label: 'Best fit', value: 'ClickHouse-backed product features' },
      ]}
      problems={[
        {
          title: 'Cube is a platform you have to operate',
          copy:
            'A production Cube deployment means Cube API instances, a refresh worker, Cube Store router and worker nodes for caching and pre-aggregations, and the data model deployed alongside them. That is a lot of operational surface when what you actually have is a handful of product queries.',
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
        title: 'A semantic layer in your codebase instead of a platform',
        description:
          'hypequery replaces the Cube server with a library. Datasets are code in TypeScript or Python, generated from your live ClickHouse schema, and serving them as APIs is one function call — no separate deployment, cache cluster, or modelling language. The examples below are TypeScript.',
        bullets: [
          'Generate TypeScript types from your live ClickHouse schema — no YAML modelling layer',
          'Define metrics as typed, composable query builder code in your own repo',
          'Serve datasets as REST endpoints with validation and OpenAPI docs, from Node or from FastAPI, Django, and Flask',
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
            competitor: 'Cube API instances and a refresh worker, plus Cube Store router and worker nodes',
            hypequery: 'A library inside your existing Node.js or Python app',
          },
          {
            label: 'Data modelling',
            competitor: 'Cubes, measures, and dimensions in YAML or JS config',
            hypequery: 'TypeScript or Python datasets, generated from your real schema',
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
            competitor: 'Postgres-compatible SQL API for Tableau, Power BI, Metabase and Superset',
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
            competitor: 'Cube Core is open source (Apache 2.0); Cube Cloud has a Free plan, then $40 or $80 per developer per month',
            hypequery: 'Free and open source (Apache 2.0)',
          },
          {
            label: 'Agents and MCP',
            competitor: 'Cube Cloud includes an MCP server and analytics agents, from the Free plan',
            hypequery: '`@hypequery/mcp` exposes your datasets and metrics as MCP tools',
          },
        ],
        footnote:
          'If the left column reads like a list of things you rely on — multiple databases, BI consumers, heavy pre-aggregation — stay with Cube. This page is for teams who noticed they only use the right column.',
      }}
      chooseAlternative={{
        title: 'When to pick Cube instead',
        bullets: [
          'BI tools such as Tableau, Power BI or Metabase need the same metric definitions as your app, through Cube’s Postgres-compatible SQL API.',
          'Your metrics span several databases, not only ClickHouse.',
          'Expensive queries hit by many users need managed pre-aggregations in Cube Store.',
          'A data team owns metric definitions separately from the product engineers who consume them.',
          'You want the vendor to host analytics agents and chat on top of the semantic layer, as Cube Cloud does.',
        ],
      }}
      searchIntentCards={[
        {
          title: 'Open source Cube.js alternative',
          copy:
            'hypequery is free and open source under Apache 2.0. Everything you need to run it in your own backend — the query builder, datasets, serving layer, OpenAPI generation, React hooks, and MCP — is in the packages. hypequery cloud is optional hosting for the same model.',
        },
        {
          title: 'Cube.js alternative without extra infrastructure',
          copy:
            'The most common reason teams go looking for an alternative is operational weight. hypequery has no server component: it runs inside your existing Node.js or Python application and talks straight to ClickHouse.',
        },
        {
          title: 'Semantic layer for ClickHouse in TypeScript or Python',
          copy:
            'If your metric definitions should live next to the code that uses them, reviewed in pull requests, that’s the workflow hypequery is built around. TypeScript and Python implement the same specification, so both serve the same React hooks and MCP tools.',
        },
        {
          title: 'When Cube is still the right answer',
          copy:
            'Multiple databases, BI tool consumers, or heavy pre-aggregation needs are Cube territory. hypequery deliberately trades that breadth for a lighter, ClickHouse-native developer experience.',
        },
      ]}
      faq={[
        {
          question: 'Is there an open-source Cube.js alternative?',
          answer:
            'Cube Core is itself open source under Apache 2.0. hypequery is a lighter open-source option under the same license: a TypeScript or Python library with no server to run, aimed at ClickHouse-backed product features rather than a shared metrics platform.',
        },
        {
          question: 'Does Cube still need Redis?',
          answer:
            'No. Cube deprecated Redis in v0.32 and removed support in v0.36. Cube Store now handles the cache, the query queue and pre-aggregations, so a production Cube Core deployment runs API instances, a refresh worker, and Cube Store router and worker nodes.',
        },
        {
          question: 'Can hypequery serve BI tools the way Cube does?',
          answer:
            'No. hypequery does not expose a SQL API for BI tools. It serves typed HTTP endpoints, React hooks and MCP tools. If Tableau, Power BI or Metabase must read the same metrics as your app, Cube’s Postgres-compatible SQL API is built for that.',
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
          href: '/python-semantic-layer',
          title: 'Python semantic layer',
          description: 'The same datasets, defined and served from Python with FastAPI, Django, or Flask.',
        },
        {
          href: '/clickhouse-api',
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
        { href: '/clickhouse-python', label: 'ClickHouse Python' },
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse Semantic Layer' },
        { href: '/tinybird-alternative', label: 'Tinybird Alternative' },
        { href: '/compare/hypequery-vs-moose', label: 'MooseStack alternative' },
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
