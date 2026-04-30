import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Analytics',
  description:
    'Build ClickHouse analytics that can be reused across product code instead of re-implementing the same metrics in routes, jobs, and dashboards.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-analytics'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-analytics'),
    title: 'ClickHouse Analytics | Build a Reusable Analytics Layer',
    description:
      'Go beyond raw ClickHouse queries and build a typed analytics layer that works across apps, dashboards, and services.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Analytics | Build a Reusable Analytics Layer',
    description:
      'Go beyond raw ClickHouse queries and build a typed analytics layer that works across apps, dashboards, and services.',
  },
};

const layerCode = `const { query, serve } = initServe({
  context: () => ({ db }),
});

const activeUsers = query({
  input: z.object({ days: z.number().int().positive() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('events')
      .where('created_at', 'gte', daysAgo(input.days))
      .countDistinct('user_id', 'active_users')
      .execute(),
});

export const api = serve({
  queries: { activeUsers },
});`;

const consumerCode = `const serverResult = await api.run('activeUsers', { input: { days: 30 } });
const httpResult = await fetch('/api/analytics/active-users');
const reactResult = useQuery('activeUsers', { days: 30 });`;

export default function ClickHouseAnalyticsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Analytics"
      title="Turn ClickHouse into a reusable analytics layer instead of a pile of raw queries"
      description="This page is about what happens after the first few queries work. The database is fast, but the same metrics start showing up in route handlers, exports, dashboards, and internal tools. hypequery gives those queries one place to live so the codebase stops forking the same logic."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/blog/the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases', label: 'Read the architecture essay' }}
      stats={[
        { label: 'Core pattern', value: 'Schema-driven analytics layer' },
        { label: 'Execution targets', value: 'Local, HTTP, React' },
        { label: 'Best fit', value: 'Product and internal analytics' },
      ]}
      problems={[
        {
          title: 'Metrics get reimplemented everywhere',
          copy:
            'A team writes one version of “active users” for a dashboard, another for an export, and another for an API. Each one is close enough to feel safe until the numbers stop matching.',
        },
        {
          title: 'The useful queries never stay local',
          copy:
            'The query that starts in one file usually ends up feeding several consumers. Without a named definition, every new consumer becomes another copy and another place for the logic to drift.',
        },
        {
          title: 'ClickHouse speed does not solve application sprawl',
          copy:
            'Fast scans are not the bottleneck once several teams or surfaces depend on the same numbers. The real problem is keeping access, filters, and result shapes consistent as usage expands.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What changes',
        title: 'Give important queries names and reuse them on purpose',
        description:
          'The main shift is simple: stop treating analytics queries as loose implementation detail. Generate the schema, define the query once, and make that definition the thing other parts of the product call.',
        bullets: [
          'Generate schema types from ClickHouse so query code matches runtime reality',
          'Define named queries in TypeScript instead of scattering SQL strings',
          'Call those definitions locally or expose them over HTTP when needed',
          'Keep input validation and response typing next to the query itself',
          'Add new consumers without rewriting the underlying metric logic',
        ],
        codePanel: {
          eyebrow: 'Named query',
          title: 'One shared definition for a metric the product keeps using',
          description:
            'The page gets much less abstract once you see the unit being shared. It is just a named query with typed input and one obvious place to change it later.',
          code: layerCode,
        },
      }}
      implementationSection={{
        eyebrow: 'What reuse looks like',
        title: 'The query stays the same even when the consumer changes',
        description:
          'This is the part that makes the architecture useful in practice. A server call, an HTTP endpoint, and a browser hook can all depend on the same query instead of growing their own local version.',
        paragraphs: [
          'That is the only claim this page really needs to make. It is not that SQL is hard. It is that reused analytics logic should stop being copied from file to file.',
          'If your current pain is runtime types, go to the TypeScript page. If your current pain is tenant-scoped customer analytics, go to the SaaS analytics page.',
        ],
        codePanel: {
          eyebrow: 'Consumers',
          title: 'Three places the same metric can show up',
          description:
            'Nothing fancy is happening here. The point is that the consumer changes and the definition does not.',
          code: consumerCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'When this architecture matters',
          copy:
            'It matters once a few queries stop being one-off reports and start feeding product features, internal tools, or several teams at the same time.',
        },
        {
          title: 'What this is not',
          copy:
            'This is not a huge BI platform and it is not trying to be. It is a code-first way to stop duplicating analytics logic inside a TypeScript application.',
        },
        {
          title: 'What teams actually gain',
          copy:
            'Fewer mismatched numbers, fewer route-specific rewrites, and one obvious place to change a metric when the definition moves.',
        },
        {
          title: 'Where to go next',
          copy:
            'Use the TypeScript page for runtime type problems, the REST page for delivery over HTTP, and the dashboard page for the browser-side consumption story.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-semantic-layer',
          title: 'ClickHouse semantic layer alternative',
          description: 'The honest positioning page: what hypequery does today, what a full semantic layer would mean, and where Cube fits.',
        },
        {
          href: '/blog/the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases',
          title: 'Why real-time data needs typed APIs',
          description: 'The most direct articulation of the analytics-layer thesis behind these pages.',
        },
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse TypeScript',
          description: 'Focus on schema types, query safety, and runtime type mapping.',
        },
        {
          href: '/clickhouse-multi-tenant-analytics',
          title: 'ClickHouse multi-tenant analytics',
          description: 'Focus on tenant isolation and safer SaaS analytics delivery.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse Semantic Layer' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'ClickHouse Multi-Tenant Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Take one repeated metric and give it a single definition',
        description:
          'Pick a metric that already exists in more than one place, move it into a named query, and wire one consumer to it. That is the fastest way to tell whether this model earns its place in your codebase.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-typescript', label: 'See TypeScript specifics' },
      }}
    />
  );
}
