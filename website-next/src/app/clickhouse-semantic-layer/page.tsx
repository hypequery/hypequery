import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Semantic Layer for TypeScript Teams | hypequery',
  description:
    'Need a ClickHouse semantic layer? hypequery gives TypeScript teams reusable query definitions and typed delivery paths, and shows where Cube or dbt MetricFlow are the better fit.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-semantic-layer'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-semantic-layer'),
    title: 'ClickHouse Semantic Layer for TypeScript Teams | hypequery',
    description:
      'Looking for a ClickHouse semantic layer? hypequery covers reusable query definitions for TypeScript apps and explains when a fuller semantic platform is the better fit.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Semantic Layer for TypeScript Teams | hypequery',
    description:
      'A ClickHouse semantic layer for TypeScript teams often starts with reusable query definitions. hypequery explains that layer and where Cube or dbt MetricFlow fit instead.',
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
      title="ClickHouse semantic layer for TypeScript teams"
      description="Most teams searching for a ClickHouse semantic layer are trying to solve one of two problems. Either they need a full semantic platform for BI and shared metrics, or they need one place to define queries that can be reused safely across APIs, jobs, dashboards, and app code. hypequery is built for the second case."
      primaryCta={{ href: '/clickhouse-analytics', label: 'Open analytics layer guide' }}
      secondaryCta={{ href: '/compare/hypequery-vs-cube', label: 'Compare with Cube' }}
      stats={[
        { label: 'Primary fit', value: 'Typed query-contract layer' },
        { label: 'Platform comparison', value: 'Lighter than Cube / MetricFlow' },
        { label: 'Best audience', value: 'TypeScript teams on ClickHouse' },
      ]}
      problems={[
        {
          title: 'A ClickHouse semantic layer can mean several different products',
          copy:
            'Sometimes the goal is centralized BI metrics for many consumers. Sometimes it is one reviewed query definition that can be reused inside a product codebase. Those overlap, but they are not the same tool.',
        },
        {
          title: 'Full semantic platforms solve a broader problem than many app teams need first',
          copy:
            'Cube and dbt MetricFlow are strong when you need centralized metrics, broader semantic modeling, multiple non-engineering consumers, or platform-level governance. Many ClickHouse teams are earlier than that and mainly need reusable typed query contracts inside a TypeScript stack.',
        },
        {
          title: 'Raw SQL is not a semantic layer just because it is shared in a few places',
          copy:
            'Even correct ClickHouse SQL drifts once the same logic is copied into dashboards, endpoints, exports, and product code. The first useful layer is a named query with typed inputs and a stable output shape.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What hypequery gives you',
        title: 'One query definition that can travel across your stack',
        description:
          'hypequery lets you define named ClickHouse queries in TypeScript, validate inputs, infer outputs from the schema, and reuse that same definition across local execution, HTTP endpoints, React hooks, and agent-facing surfaces. For many product teams, that is the useful part of the semantic-layer problem.',
        bullets: [
          'Schema-generated types from your live ClickHouse database',
          'Named query definitions instead of anonymous SQL fragments',
          'Typed inputs with Zod and typed outputs from the query result',
          'One contract reused across services, dashboards, internal tools, and app features',
          'A clean path to HTTP, OpenAPI, React, and agent-facing consumers',
          'A lighter operational footprint than running a separate semantic platform',
        ],
        codePanel: {
          eyebrow: 'Named contract',
          title: 'Define a metric-like query once',
          description:
            'This is the workflow hypequery supports well today: define a query once, type it from the live schema, and reuse it across consumers without re-authoring the logic.',
          code: contractCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Where the line is',
        title: 'Use hypequery for product delivery, and reach for Cube or dbt MetricFlow when semantic governance is the product',
        description:
          'The honest line is simple. If you need centralized metrics for BI tools, richer semantic modeling, or a dedicated platform that serves many non-engineering consumers, evaluate Cube or dbt MetricFlow. If you need reusable query definitions inside a ClickHouse-heavy TypeScript product, hypequery is the lighter fit.',
        paragraphs: [
          'A lot of teams searching for "ClickHouse semantic layer" are really trying to stop duplicating query logic across codepaths. hypequery addresses that directly by making queries first-class and reusable.',
          'If your world is BI tooling and centrally managed metric definitions, Cube and dbt MetricFlow are better search paths. If your world is shipping ClickHouse-backed features in TypeScript, hypequery is usually closer to the problem you actually have today.',
        ],
        codePanel: {
          eyebrow: 'Reuse pattern',
          title: 'One definition, several delivery paths',
          description:
            'This is the practical payoff: the same query definition can feed server code, REST endpoints, dashboards, and agent workflows without being rewritten in each place.',
          code: reuseCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse semantic layer',
          copy:
            'The key question is whether you need a full semantic metrics platform or a reusable application-layer contract for queries and metric-shaped outputs.',
        },
        {
          title: 'dbt MetricFlow alternative for TypeScript apps',
          copy:
            'dbt MetricFlow is stronger when semantic modeling and broader analytics governance are the main job. hypequery is the lighter code-first option when your main need is governed ClickHouse query reuse inside TypeScript.',
        },
        {
          title: 'Reusable metrics on ClickHouse',
          copy:
            'Reusable metrics start with named queries, typed inputs, and consistent delivery paths. That is the part hypequery solves directly for ClickHouse applications today.',
        },
        {
          title: 'Cube alternative for ClickHouse-backed apps',
          copy:
            'Cube is a stronger fit for a fuller semantic platform. hypequery is the lighter fit when the main need is reusable query contracts, typed APIs, and application delivery on top of ClickHouse.',
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
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description: 'See the lower-level query composition layer that sits underneath reusable contracts and typed delivery paths.',
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
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-mcp', label: 'ClickHouse MCP' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Decide whether you need a query-contract layer or a full semantic platform',
        description:
          'If repeated query logic inside your app is the main problem, start with the analytics layer. If you need deeper semantic capabilities, compare Cube and then decide whether your team is solving app delivery or broader semantic governance.',
        primaryCta: { href: '/clickhouse-analytics', label: 'Open analytics layer guide' },
        secondaryCta: { href: '/compare/hypequery-vs-cube', label: 'Compare with Cube' },
      }}
    />
  );
}
