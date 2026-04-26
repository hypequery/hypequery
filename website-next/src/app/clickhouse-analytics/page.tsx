import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Analytics',
  description:
    'Build a reusable ClickHouse analytics layer in TypeScript with schema-driven queries, typed APIs, and delivery paths for dashboards, apps, and internal tools.',
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
      description="ClickHouse is excellent at running analytical workloads. The harder problem is making analytics safe and reusable across dashboards, APIs, internal tools, and product features. hypequery gives TypeScript teams a practical analytics layer on top of ClickHouse."
      primaryCta={{ href: '/docs/quick-start', label: 'Open quick start' }}
      secondaryCta={{ href: '/blog/the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases', label: 'Read the architecture essay' }}
      stats={[
        { label: 'Core pattern', value: 'Schema-driven analytics layer' },
        { label: 'Execution targets', value: 'Local, HTTP, React' },
        { label: 'Best fit', value: 'Product and internal analytics' },
      ]}
      problems={[
        {
          title: 'Raw SQL scales poorly across consumers',
          copy:
            'The same metric is reimplemented in dashboards, routes, jobs, exports, and internal tools. Even if ClickHouse is fast, the application layer turns brittle.',
        },
        {
          title: 'Analytics contracts are rarely explicit',
          copy:
            'Teams know they need “active users” or “revenue by day”, but those definitions live as code fragments instead of named, reviewed, reusable assets.',
        },
        {
          title: 'Database speed does not solve governance',
          copy:
            'As more product surfaces, teams, and agents hit ClickHouse, the problem becomes safe access and reuse rather than just query execution speed.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The operating model',
        title: 'Define analytics once, then deliver them to every consumer',
        description:
          'A healthy ClickHouse analytics stack treats metrics and queries as code-level contracts. They are typed, named, reviewed, and transportable across runtime boundaries.',
        bullets: [
          'Generate schema types from ClickHouse so contracts reflect reality',
          'Define named queries in TypeScript instead of scattering SQL strings',
          'Run those definitions locally or expose them over HTTP',
          'Document and validate inputs with the same source of truth',
          'Add React hooks or external consumers without rewriting the metric',
        ],
        codePanel: {
          eyebrow: 'Shared definition',
          title: 'Create an analytics contract once',
          description:
            'This is the core shift from “database client” to “analytics layer”. The query is a named contract that multiple consumers can share.',
          code: layerCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Delivery paths',
        title: 'Support multiple consumers without rewriting the metric',
        description:
          'Once analytics are defined as contracts, the same definition can feed server-side calls, browser clients, dashboards, scheduled jobs, and eventually AI or agent workflows.',
        paragraphs: [
          'That is the practical reason to build an analytics layer: not because SQL is impossible, but because organizations need one durable definition per metric as the number of consumers grows.',
          'If your concern is the TypeScript mapping problem specifically, pair this page with the ClickHouse TypeScript pillar. If your concern is isolation in SaaS products, continue to the multi-tenant analytics pillar.',
        ],
        codePanel: {
          eyebrow: 'Multiple consumers',
          title: 'One analytics definition, several execution paths',
          description:
            'The consumer changes. The underlying metric definition does not. That is what keeps analytics coherent as a codebase grows.',
          code: consumerCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse analytics architecture',
          copy:
            'If you are evaluating how to structure product analytics on ClickHouse, the main choice is whether metrics stay as raw SQL snippets or become shared application contracts.',
        },
        {
          title: 'ClickHouse semantic layer alternative',
          copy:
            'Some teams want the benefits of a semantic layer but prefer a code-first, TypeScript-native approach that fits directly into their application stack.',
        },
        {
          title: 'Reusable metrics on ClickHouse',
          copy:
            'Reusable metrics matter when multiple teams and product surfaces need the same numbers with the same filtering and validation rules.',
        },
        {
          title: 'Typed analytics APIs',
          copy:
            'A typed analytics API turns ClickHouse access into governed application behavior instead of ad-hoc database calls spread across the stack.',
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
        title: 'Use the quick start to make your first named analytics contract real',
        description:
          'Once you see a schema-generated query run locally and over HTTP from the same definition, the analytics-layer pattern becomes concrete.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/clickhouse-typescript', label: 'See TypeScript specifics' },
      }}
    />
  );
}
