import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Tinybird Alternatives for ClickHouse APIs (2026)',
  description:
    'Tinybird alternatives compared: ClickHouse Cloud, self-hosted ClickHouse, Cube and hypequery, for typed analytics APIs on ClickHouse you own, with no ingestion step.',
  alternates: { canonical: absoluteUrl('/tinybird-alternative') },
  openGraph: {
    images: ogImage('Tinybird Alternative — Typed ClickHouse APIs on Your Own Infrastructure'),
    type: 'website',
    url: absoluteUrl('/tinybird-alternative'),
    title: 'Tinybird Alternative — Typed ClickHouse APIs on Your Own Infrastructure | hypequery',
    description:
      'Keep your data in your own ClickHouse and build the API layer in TypeScript or Python. Open source, schema-generated datasets, no platform fee.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tinybird Alternative | hypequery',
    description:
      'Typed ClickHouse analytics APIs on infrastructure you own — the open-source alternative to a managed platform.',
  },
};

const generateCode = `# point hypequery at the ClickHouse you already run
# (self-hosted or ClickHouse Cloud)
npx @hypequery/cli generate --output ./src/schema.ts

# your data never moves — the API layer comes to it`;

const serveCode = `import { initServe } from '@hypequery/serve';

const { serve } = initServe({ context: () => ({ db }) });

// what a Tinybird "Pipe" becomes: a typed endpoint in your repo
const api = serve({
  queries: { revenueByDay, activeUsers, topProducts },
});

api.start({ port: 3000 });

// POST /revenueByDay
// body: { from: "2026-01-01", to: "2026-07-03" }
// response: { data: { order_date: string; revenue: string }[] }

// GET /openapi.json — auto-generated OpenAPI spec`;

export default function TinybirdAlternativePage() {
  return (
    <ClickhousePillarPage
      leadPage="/tinybird-alternative"
      eyebrow="Tinybird Alternative"
      title="Looking for a Tinybird alternative?"
      description="Tinybird's pitch is real: point data at their ClickHouse, write SQL pipes, get APIs. What sends teams looking elsewhere is usually one of three things: the data has to live in their platform, you would be paying for a second ClickHouse-based platform next to the one you already run, or the analytics logic should live in your own application code with types from your own schema. hypequery plus your own ClickHouse covers all three."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/compare/hypequery-vs-tinybird', label: 'Read the full comparison' }}
      stats={[
        { label: 'Data location', value: 'Stays in your ClickHouse' },
        { label: 'Pricing', value: 'Free and open source' },
        { label: 'Types', value: 'Generated from live schema' },
      ]}
      problems={[
        {
          title: 'Your data has to live in their platform',
          copy:
            'Using Tinybird means ingesting your data into Tinybird-managed ClickHouse. Self-managed regions in your own AWS account exist, but Tinybird marks them beta and for development only. If you have residency requirements, compliance controls, or just a strong preference for owning your analytics data, that is usually where the conversation ends.',
        },
        {
          title: 'A second platform bill for the same data',
          copy:
            'Tinybird plans are sized in vCPUs, with overages for vCPU time, storage and data transfer. If you already run ClickHouse or pay for ClickHouse Cloud, serving the same queries through Tinybird means paying for a second ClickHouse-based platform and keeping your data in sync with it.',
        },
        {
          title: 'Types come from Tinybird definitions, not your database',
          copy:
            'Tinybird’s TypeScript SDK, which it marks experimental, infers types from the data sources and endpoints you define for Tinybird. That works for data that lives in Tinybird. It does not generate types from a ClickHouse you already run, and it does not give you a query builder or datasets inside your own application.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The alternative',
        title: 'Bring the API layer to your data, not your data to a platform',
        description:
          'hypequery assumes you run ClickHouse — self-hosted or ClickHouse Cloud — and gives you the layer Tinybird sells: queries exposed as validated HTTP endpoints, except typed end-to-end and living in your own repository.',
        bullets: [
          'Keep data in your own ClickHouse — nothing is ingested into a third-party platform',
          'Generate TypeScript types from your live schema, including ClickHouse-specific runtime mappings',
          'Define queries as code, reviewed and versioned like the rest of your application',
          'Serve them as REST endpoints with input validation and OpenAPI docs via @hypequery/serve',
          'No platform plan to size: the whole stack is open source',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Generate types from the ClickHouse you already run',
          description:
            'ClickHouse Cloud plus hypequery is the closest like-for-like Tinybird replacement: managed database, code-owned API layer, data in your own account.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Pipes become typed endpoints in your repo',
        description:
          'Each query definition becomes an HTTP endpoint with validated inputs and a typed response shape — the same publish-a-query workflow, without the platform in the middle.',
        paragraphs: [
          'The honest tradeoff: Tinybird bundles managed ingestion, endpoint hosting, token auth with per-token rate limits, and zero ops. With hypequery you own the ClickHouse instance. `@hypequery/serve` gives you JWT auth, tenant scoping and a `rateLimit` middleware, and the query builder has an optional result cache, but you deploy and run them in your own app.',
          'If you already run ClickHouse — or are happy letting ClickHouse Cloud run it — that trade usually lands on the side of owning the layer. No data movement, no lock-in on the data model, and compile-time types the whole way down.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'Serve typed endpoints from query definitions',
          description:
            'One serve() call turns query definitions into endpoints with OpenAPI documentation — consumed by your frontend through generated types instead of hand-written interfaces.',
          code: serveCode,
        },
      }}
      comparisonTable={{
        eyebrow: 'Side by side',
        title: 'Tinybird vs hypequery + your own ClickHouse',
        description:
          'The closest like-for-like swap is ClickHouse Cloud for the database and hypequery for the API layer: the database stays managed, but the queries, types, and endpoints move into your repo.',
        competitorLabel: 'Tinybird',
        rows: [
          {
            label: 'Where data lives',
            competitor: 'Ingested into Tinybird’s managed ClickHouse; self-managed regions are beta, for development only',
            hypequery: 'Stays in your ClickHouse — self-hosted or Cloud',
          },
          {
            label: 'Query definitions',
            competitor: 'SQL pipes in datafiles or TypeScript, deployed to Tinybird with the CLI',
            hypequery: 'TypeScript or Python in your repo, reviewed like any other code',
          },
          {
            label: 'TypeScript types',
            competitor: 'Inferred from your Tinybird definitions by `@tinybirdco/sdk` (experimental)',
            hypequery: 'Generated from your live schema',
          },
          {
            label: 'Auth and rate limiting',
            competitor: 'Tokens, plus JWTs with per-token rate limits and fixed tenant parameters',
            hypequery: 'JWT auth, tenant scoping and `rateLimit` middleware in `@hypequery/serve`',
          },
          {
            label: 'Rollups and caching',
            competitor: 'Materialized views and copy pipes',
            hypequery: 'ClickHouse materialized views, plus an optional query result cache',
          },
          {
            label: 'Ops burden',
            competitor: 'Zero — fully managed',
            hypequery: 'You run ClickHouse, or ClickHouse Cloud does',
          },
          {
            label: 'Pricing',
            competitor: 'Free plan, then plans sized in vCPUs plus storage, data transfer and overages',
            hypequery: 'Free and open source — you pay for your infra',
          },
          {
            label: 'Agents and MCP',
            competitor: 'Tinybird MCP server with token-scoped access to a workspace',
            hypequery: '`@hypequery/mcp` exposes your datasets and metrics as MCP tools',
          },
          {
            label: 'Leaving later',
            competitor: 'Data and ingestion live in the platform; datafiles describe Tinybird resources',
            hypequery: 'Plain code and your own database — nothing to migrate off',
          },
        ],
        footnote:
          'Zero ops is genuinely worth money to some teams. If nobody on your side wants to think about a database, Tinybird is a fine answer and this table won’t change that.',
      }}
      chooseAlternative={{
        title: 'When to pick Tinybird instead',
        bullets: [
          'You do not run ClickHouse yet and nobody on the team wants to operate it.',
          'The deliverable is hosted analytics APIs, and you want ingestion, endpoint hosting and token auth handled by one platform.',
          'Your team is more SQL-fluent than TypeScript-fluent and would rather publish SQL pipes than write application code.',
          'A vendor-run region meets your data residency and compliance needs.',
        ],
      }}
      searchIntentCards={[
        {
          title: 'Open source Tinybird alternative',
          copy:
            'hypequery is open source and free. Pair it with self-hosted ClickHouse for a fully open stack, or with ClickHouse Cloud if you want the database managed but the API layer owned.',
        },
        {
          title: 'Tinybird alternative without data ingestion',
          copy:
            'hypequery connects to the ClickHouse you already have. No ingestion step, no sync pipeline, no second copy of your data living in a vendor’s platform.',
        },
        {
          title: 'Tinybird pricing concerns at scale',
          copy:
            'With hypequery the cost model is just your ClickHouse infrastructure. API calls are your own endpoints on your own compute, with no second platform plan to size or overages to track.',
        },
        {
          title: 'When Tinybird is still the right answer',
          copy:
            'No ops capacity, SQL-first team, and a need to ship a public data API this week: Tinybird earns its price. hypequery is the fit when ownership, types, and cost control matter more than zero ops.',
        },
      ]}
      faq={[
        {
          question: 'What are the main Tinybird alternatives?',
          answer:
            'ClickHouse Cloud, if you want a managed ClickHouse database and will build the API layer yourself. Self-hosted ClickHouse, if you want to run everything. Cube, if you want a semantic layer as a separate service. hypequery, if you want typed analytics APIs defined in TypeScript or Python on the ClickHouse you already run. Propel and MooseStack, two earlier options, are no longer active: Propel\'s site points to a parking page and MooseStack has reached end of life (both checked November 2026).',
        },
        {
          question: 'Is there an open-source Tinybird alternative?',
          answer:
            'Yes. hypequery is open source under Apache 2.0. Pair it with self-hosted ClickHouse for a fully open stack, or with ClickHouse Cloud if you want the database managed and the API layer in your own code.',
        },
        {
          question: 'How does Tinybird pricing work?',
          answer:
            'Tinybird has a free plan with 0.25 vCPU, 1,000 requests per day and 10 GB of storage. Paid plans are sized in vCPUs, with overages for vCPU time, storage and data transfer, and no per-request charge. Check tinybird.co/pricing for current figures; we last checked on 8 November 2026.',
        },
        {
          question: 'Can Tinybird run in my own cloud account?',
          answer:
            'Only for development today. Tinybird’s self-managed regions run in your own AWS account, but they are in beta and Tinybird advises against production workloads. With hypequery the data stays in the ClickHouse you already run.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-fastapi',
          title: 'ClickHouse with FastAPI',
          description: 'Build the same authenticated analytics APIs from a Python backend.',
        },
        {
          href: '/compare/hypequery-vs-tinybird',
          title: 'hypequery vs Tinybird',
          description: 'The full comparison: infrastructure, pricing model, type safety, and code ownership.',
        },
        {
          href: '/clickhouse-api',
          title: 'ClickHouse REST API',
          description: 'How @hypequery/serve turns query definitions into validated, documented endpoints.',
        },
        {
          href: '/clickhouse-saas-analytics',
          title: 'ClickHouse SaaS analytics',
          description: 'Patterns for customer-facing analytics on ClickHouse, including tenant isolation.',
        },
        {
          href: '/clickhouse-real-time-analytics',
          title: 'ClickHouse real-time analytics',
          description: 'Serving fresh ClickHouse data to product features with a typed layer.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-python', label: 'ClickHouse Python' },
        { href: '/clickhouse-api', label: 'ClickHouse REST API' },
        { href: '/cube-js-alternative', label: 'Cube.js Alternative' },
        { href: '/compare/hypequery-vs-moose', label: 'MooseStack alternative' },
        { href: '/compare/clickhouse-cloud-vs-tinybird', label: 'ClickHouse Cloud vs Tinybird' },
        { href: '/compare/cube-vs-tinybird-vs-hypequery', label: 'Cube vs Tinybird vs hypequery' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Rebuild one Pipe as a typed endpoint',
        description:
          'Point hypequery at your ClickHouse, generate types, and recreate one Tinybird Pipe as a typed query served over HTTP. That’s the honest evaluation.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/compare/hypequery-vs-tinybird', label: 'Read full comparison' },
      }}
    />
  );
}
