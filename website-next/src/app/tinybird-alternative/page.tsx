import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Tinybird Alternative — Typed ClickHouse APIs on Your Own Infrastructure | hypequery',
  description:
    'Looking for a Tinybird alternative? hypequery + your own ClickHouse gives you typed analytics APIs with no data ingestion into a third-party platform and no per-query pricing.',
  alternates: { canonical: absoluteUrl('/tinybird-alternative') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/tinybird-alternative'),
    title: 'Tinybird Alternative — Typed ClickHouse APIs on Your Own Infrastructure | hypequery',
    description:
      'Keep your data in your own ClickHouse and build the API layer in TypeScript. Open source, schema-generated types, no usage-based pricing.',
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

const serveCode = `import { serve } from '@hypequery/serve';

// what a Tinybird "Pipe" becomes: a typed endpoint in your repo
const app = serve({
  queries: { revenueByDay, activeUsers, topProducts },
});

app.listen(3000);

// POST /revenueByDay
// body: { from: "2026-01-01", to: "2026-07-03" }
// response: { data: { order_date: string; revenue: string }[] }

// GET /openapi.json — auto-generated OpenAPI spec`;

export default function TinybirdAlternativePage() {
  return (
    <ClickhousePillarPage
      eyebrow="Tinybird Alternative"
      title="Looking for a Tinybird alternative?"
      description="Tinybird's pitch is real: point data at their ClickHouse, write SQL Pipes, get APIs. What sends teams looking elsewhere is usually one of three things — the data has to live in their platform, the bill grows with your traffic, or nothing in the workflow speaks TypeScript. hypequery plus your own ClickHouse fixes all three."
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
            'Using Tinybird means ingesting your data into Tinybird-managed ClickHouse. If you have residency requirements, compliance controls, or just a strong preference for owning your analytics data, the conversation ends there.',
        },
        {
          title: 'The pricing grows with your success',
          copy:
            'Tinybird bills on data processed and API calls. User-facing analytics with real traffic is exactly the workload where that gets expensive compared to running the same queries on your own ClickHouse or ClickHouse Cloud.',
        },
        {
          title: 'SQL Pipes, not TypeScript contracts',
          copy:
            'Pipes are SQL in Tinybird’s workflow, and your app consumes the endpoints as untyped HTTP. Nothing generates TypeScript types from your schema, so every consumer ends up hand-maintaining its own interfaces.',
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
          'No per-query or per-GB pricing — the whole stack is open source',
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
          'The honest tradeoff: Tinybird bundles managed ingestion, caching, token-based rate limiting, and zero ops. With hypequery you own the ClickHouse instance, and auth and caching come from your existing API stack rather than a platform.',
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
            competitor: 'Ingested into Tinybird’s managed ClickHouse',
            hypequery: 'Stays in your ClickHouse — self-hosted or Cloud',
          },
          {
            label: 'Query definitions',
            competitor: 'SQL Pipes in Tinybird’s workflow',
            hypequery: 'TypeScript in your repo, reviewed like any other code',
          },
          {
            label: 'TypeScript types',
            competitor: 'Hand-maintained interfaces over HTTP responses',
            hypequery: 'Generated from your live schema',
          },
          {
            label: 'Auth and rate limiting',
            competitor: 'Built in, token-based',
            hypequery: 'Your existing API stack',
          },
          {
            label: 'Caching',
            competitor: 'Built in',
            hypequery: 'Bring your own, or ClickHouse materialized views',
          },
          {
            label: 'Ops burden',
            competitor: 'Zero — fully managed',
            hypequery: 'You run ClickHouse, or ClickHouse Cloud does',
          },
          {
            label: 'Pricing',
            competitor: 'Data processed plus API calls',
            hypequery: 'Free and open source — you pay for your infra',
          },
          {
            label: 'Leaving later',
            competitor: 'Schema, Pipes, and ingestion live in the platform',
            hypequery: 'Plain code and your own database — nothing to migrate off',
          },
        ],
        footnote:
          'Zero ops is genuinely worth money to some teams. If nobody on your side wants to think about a database, Tinybird is a fine answer and this table won’t change that.',
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
            'With hypequery the cost model is just your ClickHouse infrastructure. API calls are your own endpoints on your own compute — no per-request or per-GB-processed billing.',
        },
        {
          title: 'When Tinybird is still the right answer',
          copy:
            'No ops capacity, SQL-first team, and a need to ship a public data API this week: Tinybird earns its price. hypequery is the fit when ownership, types, and cost control matter more than zero ops.',
        },
      ]}
      readingLinks={[
        {
          href: '/compare/hypequery-vs-tinybird',
          title: 'hypequery vs Tinybird',
          description: 'The full comparison: infrastructure, pricing model, type safety, and code ownership.',
        },
        {
          href: '/clickhouse-rest-api',
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
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/cube-js-alternative', label: 'Cube.js Alternative' },
        { href: '/moosestack-alternative', label: 'MooseStack Alternative' },
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
