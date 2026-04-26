import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Time-Series Queries for TypeScript Apps | hypequery',
  description:
    'Build readable ClickHouse time-series queries with explicit DateTime handling, reusable range logic, and date bucketing patterns that fit TypeScript apps.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-time-series'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-time-series'),
    title: 'ClickHouse Time-Series Queries for TypeScript Apps | hypequery',
    description:
      'Build readable ClickHouse time-series queries with explicit DateTime handling, reusable range logic, and date bucketing patterns that fit TypeScript apps.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Time-Series Queries for TypeScript Apps | hypequery',
    description:
      'Build readable ClickHouse time-series queries with explicit DateTime handling, reusable range logic, and date bucketing patterns that fit TypeScript apps.',
  },
};

const timeSeriesQueryCode = `// analytics/time-series.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

// Schema generation captures DateTime → string mapping:
// npx @hypequery/cli generate --output ./schema.ts
//
// type EventRow = {
//   created_at: string;   // DateTime in ClickHouse, string in TypeScript
//   event_date: string;   // Date in ClickHouse, string in TypeScript
//   value: string;        // Decimal64 in ClickHouse, string in TypeScript
//   count: string;        // UInt64 in ClickHouse, string in TypeScript
// }
//
// Parse DateTime strings explicitly at the chart layer and keep timezone handling deliberate.

const db = createQueryBuilder<Schema>({ /* connection config */ });

// toStartOfDay is ClickHouse-native — returns a DateTime truncated to midnight
// groupBy the alias, not the expression, to avoid repeating it
export async function getDailyMetrics(opts: {
  tenantId: string;
  startDate: string;
  endDate: string;
}) {
  return db
    .table('events')
    .select(
      'toStartOfDay(created_at) as day',    // ClickHouse date truncation
      'count() as events',
      'uniq(user_id) as active_users',
      'sum(revenue_cents) as revenue',
    )
    .where('tenant_id', 'eq', opts.tenantId)
    .where('created_at', 'gte', opts.startDate)
    .where('created_at', 'lte', opts.endDate)
    .groupBy('day')
    .orderBy('day', 'ASC')
    .execute();
}

// Return type inferred from the query —
// { day: string; events: string; active_users: string; revenue: string }[]
// All numeric aggregates are strings because ClickHouse UInt64/Decimal → string.`;

const reusableTimeRangeCode = `// analytics/time-range-queries.ts — composable time-range pattern
import { initServe } from '@hypequery/serve';
import { db } from '@/lib/clickhouse';
import { z } from 'zod';

type Granularity = 'minute' | 'hour' | 'day' | 'week';

// Map granularity to the appropriate ClickHouse date function
const granularityFn: Record<Granularity, string> = {
  minute: 'toStartOfMinute',
  hour:   'toStartOfHour',
  day:    'toStartOfDay',
  week:   'toStartOfWeek',
};

// Reusable preset time ranges — avoids duplicating these across every query
function presetRange(preset: '1h' | '24h' | '7d' | '30d'): { start: string; end: string } {
  const now = new Date();
  const msMap = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 };
  const start = new Date(now.getTime() - msMap[preset]).toISOString().replace('T', ' ').slice(0, 19);
  const end = now.toISOString().replace('T', ' ').slice(0, 19);
  return { start, end };
}

const { query, serve } = initServe({
  context: (req) => ({ db, tenantId: req.headers['x-tenant-id'] as string }),
});

export const timeSeries = query({
  input: z.object({
    granularity: z.enum(['minute', 'hour', 'day', 'week']).default('day'),
    preset:      z.enum(['1h', '24h', '7d', '30d']).optional(),
    startDate:   z.string().optional(),
    endDate:     z.string().optional(),
    metric:      z.enum(['events', 'users', 'revenue']).default('events'),
  }),
  query: ({ ctx, input }) => {
    const { start, end } =
      input.preset
        ? presetRange(input.preset)
        : { start: input.startDate!, end: input.endDate! };

    const truncFn = granularityFn[input.granularity];

    // Select the right aggregation based on the requested metric
    const metricSelect =
      input.metric === 'events'  ? 'count() as value' :
      input.metric === 'users'   ? 'uniq(user_id) as value' :
      /* revenue */                'sum(revenue_cents) as value';

    return ctx.db
      .table('events')
      .select(\`\${truncFn}(created_at) as period\`, metricSelect)
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('created_at', 'gte', start)
      .where('created_at', 'lte', end)
      .groupBy('period')
      .orderBy('period', 'ASC')
      .execute();
  },
});

export const api = serve({ queries: { timeSeries } });`;

export default function ClickHouseTimeSeriesPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Time Series"
      title="Typed time-series queries on ClickHouse in TypeScript"
      description="Time-series queries are the most common ClickHouse use case and the most common source of subtle TypeScript bugs — because ClickHouse DateTime columns return as strings and ClickHouse date functions are specific to ClickHouse SQL. hypequery gives TypeScript teams a composable, type-safe path to time-series analytics."
      primaryCta={{ href: '/docs/quick-start', label: 'Open quick start' }}
      secondaryCta={{ href: '/clickhouse-analytics', label: 'See analytics layer overview' }}
      stats={[
        { label: 'Date functions', value: 'toStartOfDay, toStartOfHour, toStartOfWeek' },
        { label: 'DateTime mapping', value: 'DateTime → string (not Date)' },
        { label: 'Best for', value: 'Time-series dashboards and trend analysis' },
      ]}
      problems={[
        {
          title: 'ClickHouse date functions are ClickHouse-specific — generic query builders miss them',
          copy:
            "Time-series queries in ClickHouse live or die on date bucketing. toStartOfDay, toStartOfHour, and toStartOfWeek are central to the workload, and a TypeScript layer needs to make those patterns readable instead of burying them in repetitive string fragments.",
        },
        {
          title: 'DateTime columns return as strings — TypeScript that expects Date objects breaks silently',
          copy:
            "ClickHouse DateTime columns are returned as strings over the HTTP interface. TypeScript code that assigns them to Date properties or passes them to functions expecting Date objects compiles fine but behaves incorrectly at runtime. Schema-generated types map DateTime to string explicitly, making the correct handling visible.",
        },
        {
          title: 'Reusable time-range filters get duplicated across every time-series query',
          copy:
            'Last 7 days, last 30 days, custom range — every chart in a time-series dashboard needs the same time-range logic. Without a shared, composable pattern, the date arithmetic is copy-pasted across every query and endpoint, making changes fragile.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Time-series query pattern',
        title: 'toStartOfDay groupBy with schema-generated DateTime string types',
        description:
          'The foundation of correct time-series queries in TypeScript on ClickHouse is understanding the DateTime → string mapping and using it intentionally. Schema generation makes this explicit at the type level rather than leaving it as a runtime discovery.',
        bullets: [
          'Generate schema types — DateTime columns appear as string in the emitted TypeScript',
          'Use toStartOfDay(created_at) as day in .select() for daily bucketing',
          'GroupBy the alias (day) not the expression to avoid repetition',
          'UInt64 aggregates (count, sum) also return as string — parse at the chart layer with parseInt or parseFloat',
          'Parse ClickHouse DateTime strings explicitly in the chart layer and be deliberate about timezone handling',
        ],
        codePanel: {
          eyebrow: 'Time-series query',
          title: 'Daily metrics query with toStartOfDay and typed DateTime strings',
          description:
            'The return type comment makes the string nature of all numeric and date fields explicit. This is what schema generation emits — and what the chart layer must handle correctly.',
          code: timeSeriesQueryCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Reusable time-range pattern',
        title: 'Configurable granularity and preset time ranges without query duplication',
        description:
          'A reusable time-series query accepts granularity (minute/hour/day/week) and either a preset range or explicit start/end dates. This single definition replaces the per-chart date logic that typically gets duplicated across dashboards.',
        paragraphs: [
          'The granularityFn map keeps the ClickHouse-specific function names in one place. If the available granularities change, the map is the only thing that needs updating — not every query that uses date bucketing.',
          'Preset time ranges are pre-computed in TypeScript before being passed to ClickHouse. This is simpler than using ClickHouse NOW() minus interval expressions, which are harder to type and test.',
        ],
        codePanel: {
          eyebrow: 'Reusable time-series API',
          title: 'One query definition for all granularities and time-range presets',
          description:
            'The query handles minute, hour, day, and week granularity through a single parameter. Adding a new granularity means adding one entry to granularityFn — not a new query.',
          code: reusableTimeRangeCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse time series TypeScript',
          copy:
            'Time-series work gets messy when every chart reimplements date parsing, bucketing, and range logic. A reusable query pattern is more valuable than a one-off date helper.',
        },
        {
          title: 'ClickHouse toStartOfDay TypeScript',
          copy:
            'toStartOfDay is usually the first useful bucket, but the real pattern is keeping the bucketing expression readable and grouping by the alias instead of repeating the function call.',
        },
        {
          title: 'ClickHouse DateTime TypeScript',
          copy:
            'ClickHouse DateTime values arrive as strings over HTTP. If that stays implicit, chart code quietly treats them like Date objects and bugs slip through.',
        },
        {
          title: 'ClickHouse date groupBy TypeScript',
          copy:
            'GroupBy on a date function expression works best when the expression is aliased in SELECT and the alias is used in GROUP BY. hypequery .groupBy() accepts the alias string, keeping queries readable.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-product-analytics',
          title: 'ClickHouse Product Analytics',
          description: 'DAU, retention, and funnel queries that build on time-series patterns.',
        },
        {
          href: '/clickhouse-analytics',
          title: 'ClickHouse Analytics',
          description: 'The broader analytics layer that time-series queries plug into.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description: 'The full query builder API including select, where, groupBy, and orderBy.',
        },
        {
          href: '/clickhouse-real-time-analytics',
          title: 'ClickHouse Real-Time Analytics',
          description: 'Time-series queries at real-time polling rates with narrow filters and explicit date bucketing.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-product-analytics', label: 'ClickHouse Product Analytics' },
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-real-time-analytics', label: 'ClickHouse Real-Time Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Generate your schema and write a typed toStartOfDay time-series query',
        description:
          'Schema generation captures the DateTime → string mapping for your tables. Once that is in place, a daily metrics query with toStartOfDay groupBy follows the pattern above and is immediately usable in a chart component.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/clickhouse-query-builder', label: 'Explore the query builder API' },
      }}
    />
  );
}
