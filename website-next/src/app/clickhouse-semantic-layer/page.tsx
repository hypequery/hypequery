import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Semantic Layer Alternative for TypeScript Teams | hypequery',
  description:
    'hypequery is not a full semantic layer. It gives ClickHouse teams reusable typed query contracts, HTTP delivery, and governed query reuse while fuller semantic-layer capabilities remain on the roadmap.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-semantic-layer'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-semantic-layer'),
    title: 'ClickHouse Semantic Layer Alternative | hypequery',
    description:
      'If you want a ClickHouse semantic layer, start with the honest distinction: hypequery provides reusable typed query contracts today, not a full metrics-semantic platform.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Semantic Layer Alternative | hypequery',
    description:
      'hypequery is not a full semantic layer. It helps ClickHouse teams define reusable typed query contracts and delivery paths today.',
  },
};

const contractCode = `const { query, serve } = initServe({
  context: (req) => ({
    db,
    tenantId: req.headers['x-tenant-id'] as string,
  }),
});

export const revenueByDay = query({
  input: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .select('order_date', 'sum(total) as revenue')
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('created_at', 'gte', input.startDate)
      .where('created_at', 'lte', input.endDate)
      .groupBy('order_date')
      .orderBy('order_date', 'ASC')
      .execute(),
});

export const api = serve({
  queries: { revenueByDay },
});`;

const reuseCode = `// same named contract, several consumers
const serverResult = await api.run('revenueByDay', {
  input: { startDate: '2026-04-01', endDate: '2026-04-30' },
});

const httpResult = await fetch('/api/analytics/revenueByDay', {
  method: 'POST',
  body: JSON.stringify({ startDate: '2026-04-01', endDate: '2026-04-30' }),
});

const { data } = useQuery('revenueByDay', {
  startDate: '2026-04-01',
  endDate: '2026-04-30',
});`;

export default function ClickHouseSemanticLayerPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Semantic Layer"
      title="A semantic-layer alternative for ClickHouse, with honest limits"
      description="Some teams searching for a ClickHouse semantic layer do not actually need a full metrics platform on day one. They need reusable named queries, typed inputs and outputs, safer delivery paths, and one reviewed contract per metric. hypequery does that well today. It is not a full semantic layer, and semantic-analysis capabilities are on the roadmap rather than already shipped."
      primaryCta={{ href: '/clickhouse-analytics', label: 'See the analytics layer' }}
      secondaryCta={{ href: 'https://github.com/hypequery/hypequery/issues', label: 'Request semantic-layer features' }}
      stats={[
        { label: 'What hypequery is', value: 'Typed query-contract layer' },
        { label: 'What it is not', value: 'Full semantic metrics platform' },
        { label: 'Best fit', value: 'Product and app teams on ClickHouse' },
      ]}
      problems={[
        {
          title: 'Raw ClickHouse queries do not become a governed metrics layer by themselves',
          copy:
            'Even when the SQL is correct, metrics drift once the same idea is repeated across dashboards, APIs, exports, and internal tools. Teams need named contracts, not more scattered query strings.',
        },
        {
          title: 'Full semantic layers can be heavier than what product teams need first',
          copy:
            'Tools like Cube are strong when you need central metrics for BI tools, multiple external consumers, caching, and pre-aggregations. Many ClickHouse teams are earlier than that and mainly need governed reuse inside a TypeScript application stack.',
        },
        {
          title: 'The term "semantic layer" covers several different needs',
          copy:
            'Sometimes the need is metric governance. Sometimes it is type-safe delivery into apps. Sometimes it is AI-safe query exposure. Those overlap, but they are not the same product surface.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What hypequery does today',
        title: 'Reusable typed query contracts that travel across your stack',
        description:
          'hypequery lets you define named ClickHouse queries in TypeScript, validate inputs, infer outputs from the schema, and reuse the same contract across local execution, HTTP endpoints, React hooks, and agent-facing surfaces. That covers an important part of the semantic-layer problem: governed reuse.',
        bullets: [
          'Schema-generated types from your live ClickHouse database',
          'Named query definitions instead of anonymous SQL fragments',
          'Typed inputs with Zod and typed outputs from the query result',
          'One contract reused across services, dashboards, and app features',
          'A clean path to HTTP, OpenAPI, React, and MCP-style consumers',
          'No claim of full semantic modeling, metric compiler rules, or BI-wide governance today',
        ],
        codePanel: {
          eyebrow: 'Named contract',
          title: 'Define a metric-like query once',
          description:
            'This is the part hypequery does well today: define a query contract once, type it from the real schema, and make it reusable across consumers.',
          code: contractCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Where the boundary is',
        title: 'Use hypequery for governed reuse, and reach for Cube when you need a full semantic platform',
        description:
          'The honest line is simple. If you need centralized metrics serving many BI and non-engineering consumers, pre-aggregations, and a dedicated semantic platform, evaluate Cube. If you need reusable query contracts inside a ClickHouse-heavy TypeScript product, hypequery is a lighter fit.',
        paragraphs: [
          'A lot of teams searching for "ClickHouse semantic layer" are really trying to stop duplicating query logic across codepaths. hypequery addresses that directly by making queries first-class, typed, and transportable.',
          'If semantic analysis, richer metric semantics, or more explicit modeling capabilities are important to your workflow, open an issue. That is a legitimate extension area for hypequery, but it should be described as roadmap work, not present-day functionality.',
        ],
        codePanel: {
          eyebrow: 'Reuse pattern',
          title: 'One definition, several delivery paths',
          description:
            'This is the practical payoff: the same reviewed query contract can feed server code, REST endpoints, dashboards, and agent workflows without being re-authored in each place.',
          code: reuseCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse semantic layer',
          copy:
            'If you want a ClickHouse semantic layer, first decide whether you need a full metrics platform or a reusable application-layer contract for queries and metrics.',
        },
        {
          title: 'Cube.js alternative for ClickHouse apps',
          copy:
            'Cube is a stronger fit for centralized semantic serving across many consumers. hypequery is the lighter code-first option when your main need is governed query reuse inside a TypeScript stack.',
        },
        {
          title: 'Reusable metrics on ClickHouse',
          copy:
            'Reusable metrics start with named contracts, typed inputs, and consistent delivery paths. That is the part hypequery solves directly today.',
        },
        {
          title: 'Semantic layer roadmap for hypequery',
          copy:
            'hypequery is not claiming full semantic-layer functionality today. If that is the missing piece for your use case, the right move is to raise it directly as a roadmap request.',
        },
      ]}
      readingLinks={[
        {
          href: '/blog/the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases',
          title: 'The analytics language layer essay',
          description: 'The broader argument for why reusable governed query contracts matter in modern analytics stacks.',
        },
        {
          href: '/clickhouse-analytics',
          title: 'ClickHouse Analytics',
          description: 'The practical product page for building a reusable analytics layer on ClickHouse.',
        },
        {
          href: '/compare/hypequery-vs-cube',
          title: 'hypequery vs Cube',
          description: 'A direct comparison between a code-first query layer and a fuller semantic-layer platform.',
        },
        {
          href: '/clickhouse-mcp',
          title: 'ClickHouse MCP',
          description: 'How defined query contracts become safer AI-agent tools than raw SQL exposure.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'ClickHouse Multi-Tenant Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Decide whether you need a query-contract layer or a full semantic platform',
        description:
          'If governed query reuse inside your app is the main problem, start with the analytics layer. If you need deeper semantic capabilities, compare Cube and tell us what hypequery would need to support your workflow.',
        primaryCta: { href: '/clickhouse-analytics', label: 'Open analytics layer guide' },
        secondaryCta: { href: '/compare/hypequery-vs-cube', label: 'Compare with Cube' },
      }}
    />
  );
}
