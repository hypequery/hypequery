import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Real-Time Analytics in TypeScript | hypequery',
  description:
    'Query ClickHouse in real time with TypeScript. hypequery gives you typed queries for live analytics dashboards — low-latency reads, tenant isolation, and typed HTTP APIs.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-real-time-analytics'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-real-time-analytics'),
    title: 'ClickHouse Real-Time Analytics in TypeScript | hypequery',
    description:
      'Query ClickHouse in real time with TypeScript. hypequery gives you typed queries for live analytics dashboards — low-latency reads, tenant isolation, and typed HTTP APIs.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Real-Time Analytics in TypeScript | hypequery',
    description:
      'Query ClickHouse in real time with TypeScript. hypequery gives you typed queries for live analytics dashboards — low-latency reads, tenant isolation, and typed HTTP APIs.',
  },
};

const realtimeQueryCode = `// analytics/realtime-queries.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ /* connection config */ });

export async function getLiveMetrics(tenantId: string) {
  return db
    .table('events')
    .select(
      'count() as events_last_5m',
      'uniq(user_id) as active_users',
      'uniq(session_id) as active_sessions',
      'avg(response_time_ms) as avg_latency',
    )
    .where('tenant_id', 'eq', tenantId)
    .where('created_at', 'gte', minutesAgo(5))
    .execute();
}

// Minute-by-minute breakdown for a sparkline
export async function getEventRate(tenantId: string, windowMinutes = 30) {
  return db
    .table('events')
    .select(
      'toStartOfMinute(created_at) as minute',
      'count() as events',
      'uniq(user_id) as users',
    )
    .where('tenant_id', 'eq', tenantId)
    .where('created_at', 'gte', minutesAgo(windowMinutes))
    .groupBy('minute')
    .orderBy('minute', 'ASC')
    .execute();
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString().replace('T', ' ').slice(0, 19);
}`;

const pollingAndStreamingCode = `// React polling with hypequery hooks
import { createHooks } from '@hypequery/react';
import { InferApiType } from '@hypequery/serve';
import type { api } from '@/analytics/realtime-queries';

type Api = InferApiType<typeof api>;

const { useQuery } = createHooks<Api>({ baseUrl: '/api/analytics' });

// Polling pattern — refetch every 5 s via TanStack Query
export function LiveMetricsPanel({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery(
    'liveMetrics',
    { tenantId },
    { refetchInterval: 5_000 },   // TanStack Query option passed through
  );

  return (
    <div className="grid grid-cols-4 gap-4">
      <MetricCard label="Events / 5 min" value={data?.events_last_5m ?? '—'} loading={isLoading} />
      <MetricCard label="Active users"   value={data?.active_users ?? '—'}   loading={isLoading} />
      <MetricCard label="Sessions"       value={data?.active_sessions ?? '—'} loading={isLoading} />
      <MetricCard label="Avg latency ms" value={data?.avg_latency ?? '—'}    loading={isLoading} />
    </div>
  );
}

// SSE / streaming pattern — same query definition, different delivery
// app/api/analytics/stream/route.ts (Next.js App Router)
export async function GET(req: Request) {
  const { tenantId } = parseAuth(req);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        const data = await getLiveMetrics(tenantId);   // same hypequery call
        controller.enqueue(encoder.encode(\`data: \${JSON.stringify(data)}\n\n\`));
      };
      await send();
      const interval = setInterval(send, 5_000);
      req.signal.addEventListener('abort', () => clearInterval(interval));
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}`;

export default function ClickHouseRealTimeAnalyticsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Real-Time Analytics"
      title="Real-time ClickHouse analytics queries in TypeScript"
      description="ClickHouse is built for low-latency analytical reads. Getting that latency into a live TypeScript dashboard requires a query layer that keeps filters typed, keeps selected columns narrow, and works consistently across polling and streaming delivery patterns."
      primaryCta={{ href: '/docs/quick-start', label: 'Open quick start' }}
      secondaryCta={{ href: '/clickhouse-dashboard', label: 'See dashboard setup' }}
      stats={[
        { label: 'ClickHouse optimisation', value: 'Narrow selects and time filters' },
        { label: 'Delivery patterns', value: 'Polling and SSE streaming' },
        { label: 'Best for', value: 'Live dashboards and monitoring UIs' },
      ]}
      problems={[
        {
          title: 'Generic query layers add overhead that kills ClickHouse latency',
          copy:
            "Real-time queries must be fast and re-runnable. A query layer that hides ClickHouse entirely tends to encourage wide selects and ad hoc response reshaping, which throws away a lot of ClickHouse's latency advantage even before you think about transport or caching.",
        },
        {
          title: 'Live dashboards need query definitions that work for both polling and streaming',
          copy:
            'A live dashboard might poll via HTTP on one page and stream via SSE on another. If the query definition has to be duplicated or re-expressed for each delivery pattern, it becomes inconsistent and fragile.',
        },
        {
          title: 'At real-time query rates, type errors are harder to catch',
          copy:
            'When queries run every five seconds, a schema drift — a renamed column, a type change — becomes a continuous error stream instead of a one-off bug. Schema-generated types that catch the mismatch at compile time are not optional at real-time rates.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Low-latency query pattern',
        title: 'Typed, narrow queries for low-latency ClickHouse reads',
        description:
          'The core win for real-time analytics is not a magic helper method. It is a repeatable query shape: filter by tenant and recent time windows, keep the selected columns narrow, and expose the query through a stable typed API that the frontend can poll confidently.',
        bullets: [
          'Filter hard on tenant_id and recent time ranges in every live query',
          'Keep SELECT lists narrow — avoid wide event payloads in hot paths',
          'Use uniq() instead of COUNT(DISTINCT) for real-time active user counts at scale',
          'Use typed query definitions so polling endpoints do not drift silently',
          'When you need hand-tuned ClickHouse SQL such as PREWHERE, use rawQuery() intentionally instead of pretending the builder wraps it today',
          'Generate schema types to catch column renames before they reach production',
        ],
        codePanel: {
          eyebrow: 'Low-latency queries',
          title: 'Real-time metrics with explicit filters and narrow selects',
          description:
            'These queries stay honest to the current API surface: standard typed .where() filters, narrow projections, and reusable time-window helpers. If you later need a hand-tuned PREWHERE query, that is a separate raw SQL decision.',
          code: realtimeQueryCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Polling and streaming',
        title: 'One query definition, two delivery patterns — polling and SSE',
        description:
          'The same hypequery call that powers a polling React hook can also power an SSE endpoint. The query definition is not coupled to the delivery mechanism, so teams can switch or combine patterns without rewriting queries.',
        paragraphs: [
          'Polling via TanStack Query is the simpler path and works for most live dashboards. The refetchInterval option on the hook handles the scheduling without custom setInterval code in components.',
          'SSE is appropriate when multiple panels need to update in lockstep, or when the client cannot afford a round-trip for every panel independently. The streaming route uses the same getLiveMetrics call — just delivered differently.',
        ],
        codePanel: {
          eyebrow: 'Polling and SSE',
          title: 'React polling hook and SSE route from the same query definition',
          description:
            'The key is that getLiveMetrics is a plain async function. Both the polling hook and the streaming route call it without modification.',
          code: pollingAndStreamingCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse real-time queries TypeScript',
          copy:
            'Real-time TypeScript queries on ClickHouse require a query layer that avoids column over-reads, keeps time filters explicit, and delivers schema-generated types so regressions are caught at build time.',
        },
        {
          title: 'ClickHouse live dashboard TypeScript',
          copy:
            'A live TypeScript dashboard on ClickHouse is best served by a thin polling or SSE layer on top of a typed analytics API — not a WebSocket to raw ClickHouse.',
        },
        {
          title: 'ClickHouse low latency analytics API',
          copy:
            'Low-latency ClickHouse analytics APIs rely on PREWHERE, narrow selects, and correct indexing. The application layer should not obscure those optimisations behind generic abstractions.',
        },
        {
          title: 'ClickHouse streaming analytics TypeScript',
          copy:
            'Streaming ClickHouse analytics in TypeScript means deciding between SSE, WebSocket, and polling. For most dashboards, polling via TanStack Query with a short interval is simpler and more maintainable than a persistent streaming connection.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-dashboard',
          title: 'ClickHouse Dashboard',
          description: 'Full setup for typed React dashboards on ClickHouse with hooks and API layer.',
        },
        {
          href: '/clickhouse-react',
          title: 'ClickHouse React',
          description: 'Typed hooks and TanStack Query integration for ClickHouse data.',
        },
        {
          href: '/clickhouse-product-analytics',
          title: 'ClickHouse Product Analytics',
          description: 'DAU, funnel, and retention queries for product analytics use cases.',
        },
        {
          href: '/blog/the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases',
          title: 'Why real-time data needs typed APIs',
          description: 'The case for a typed analytics layer over raw real-time ClickHouse access.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-dashboard', label: 'ClickHouse Dashboard' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-product-analytics', label: 'ClickHouse Product Analytics' },
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Write your first live metrics query and measure the actual latency',
        description:
          'Generate your schema, write a live metrics query with tenant and time filters, and connect it to a polling React hook. Once that path is working, you can profile whether raw ClickHouse-specific tuning is even necessary.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/clickhouse-dashboard', label: 'See dashboard setup' },
      }}
    />
  );
}
