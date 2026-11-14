export type ClickHouseFunctionCluster = 'date' | 'aggregate' | 'string' | 'conditional' | 'math' | 'array';

export type ClickHouseFunctionDef = {
  slug: string;
  name: string;
  cluster: ClickHouseFunctionCluster;
  tagline: string;
  metaTitle: string;
  metaDescription: string;
  signature: string;
  description: string;
  longDescription: string;
  exampleSql: string;
  hypequeryExample: string;
  hypequeryFilename: string;
  /** A Python example, run against the fixture tables in scripts/check-function-examples.mts. */
  pythonExample?: string;
  pythonFilename?: string;
  /** One sentence shown beside the Python example, such as why it calls the driver directly. */
  pythonNote?: string;
  returnType: string;
  notes: string[];
  relatedFunctions: string[];
  relatedPillars: { href: string; label: string }[];
  searchIntentCards: { title: string; copy: string }[];
  faqItems: { question: string; answer: string }[];
  /** What a hypequery query returns for this function in TypeScript. */
  tsType?: string;
  /** The official ClickHouse reference for this function. */
  docsUrl?: string;
  /** ISO date the page was last checked against ClickHouse. Shown on the page and as dateModified. */
  updated?: string;
  /** A callout under the tagline that sends readers searching for a sibling function to its page. */
  seeAlso?: { href: string; label: string; copy: string };
};

/**
 * Function pages that stay in Google's index. These are the pages with search
 * demand in Search Console (500+ impressions over three months in November
 * 2026), plus sumIf, which targets sumIf searches that currently land on the
 * sum page without clicks, and count, which is submitted for indexing. The
 * rest stay reachable for readers but are noindexed and left out of the sitemap: ClickHouse's own docs answer those
 * queries, so they add pages to crawl without bringing visitors.
 */
export const indexedFunctionSlugs: ReadonlySet<string> = new Set([
  'quantile',
  'groupArray',
  'sum',
  'sumIf',
  'count',
  'formatDateTime',
  'toStartOfWeek',
  'multiIf',
  'toString',
  'toDate',
]);

export function functionPathSegment(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

export const clickhouseFunctions: ClickHouseFunctionDef[] = [
  // ── DATE CLUSTER ────────────────────────────────────────────────────────────
  {
    slug: 'toStartOfDay',
    name: 'toStartOfDay',
    cluster: 'date',
    tagline: 'Truncate a DateTime to midnight — the foundation of daily analytics bucketing.',
    metaTitle: 'ClickHouse toStartOfDay — TypeScript daily bucketing',
    metaDescription:
      'toStartOfDay truncates a DateTime to midnight. Learn how to use it in TypeScript with hypequery for daily trend charts, DAU counts, and time-series grouping.',
    signature: 'toStartOfDay(datetime: DateTime): DateTime',
    description:
      'Rounds a DateTime value down to midnight (00:00:00) on the same calendar day in the column\'s time zone. Essential for GROUP BY day queries.',
    longDescription:
      'toStartOfDay is the most commonly used date-truncation function in ClickHouse analytics. It strips the time component, leaving the date at midnight, so that events from the same calendar day hash to the same bucket. Combined with GROUP BY, it produces one row per day — the building block of trend charts, daily active user counts, and rolling-window calculations.',
    exampleSql: `SELECT
  toStartOfDay(created_at) AS day,
  count() AS events
FROM events
GROUP BY day
ORDER BY day DESC
LIMIT 30`,
    hypequeryExample: `import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const daily = await db
  .table('events')
  .select([selectExpr('toStartOfDay(created_at)', 'day')])
  .count('id', 'events')
  .groupBy('day')
  .orderBy('day', 'DESC')
  .limit(30)
  .execute();`,
    hypequeryFilename: 'daily-events.ts',
    returnType: 'DateTime',
    notes: [
      'The result is in the time zone of the DateTime column — use toStartOfDay(col, \'UTC\') to force UTC.',
      'For daily partitioning use toYYYYMMDD instead — it returns a UInt32 suitable for PARTITION BY.',
      'Combine with toStartOfWeek and toStartOfMonth for drill-down hierarchies.',
    ],
    relatedFunctions: ['toStartOfWeek', 'toStartOfMonth', 'toStartOfInterval', 'toYYYYMMDD'],
    relatedPillars: [
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-real-time-analytics', label: 'Real-Time Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'GROUP BY day in ClickHouse',
        copy: 'toStartOfDay is the standard way to bucket rows into calendar days. It normalises any DateTime to midnight, so GROUP BY toStartOfDay(ts) gives one row per day.',
      },
      {
        title: 'Daily active users (DAU) in ClickHouse',
        copy: 'DAU queries count distinct user_ids per day. Use toStartOfDay on your event timestamp column, then COUNT(DISTINCT user_id) within each day bucket.',
      },
      {
        title: 'ClickHouse date truncation TypeScript',
        copy: 'hypequery exposes raw SQL expressions inside select and groupBy, so you can pass toStartOfDay(created_at) directly and get typed results back.',
      },
    ],
    faqItems: [
      {
        question: 'What does toStartOfDay return?',
        answer: 'It returns a DateTime value set to 00:00:00 on the same calendar day as the input, in the column\'s time zone.',
      },
      {
        question: 'How do I use toStartOfDay with a specific time zone?',
        answer: 'Pass the time zone as a second argument: toStartOfDay(created_at, \'America/New_York\'). Without it, the column\'s stored time zone is used.',
      },
      {
        question: 'Can I use toStartOfDay in a WHERE clause?',
        answer: 'Yes, but it\'s more efficient to filter on a range: WHERE created_at >= toStartOfDay(today()) instead of WHERE toStartOfDay(created_at) = today().',
      },
    ],
  },

  {
    slug: 'toStartOfWeek',
    name: 'toStartOfWeek',
    cluster: 'date',
    tagline: 'Round a date down to the start of its week. Mode 0, the default, starts weeks on Sunday; mode 1 starts them on Monday.',
    metaTitle: 'ClickHouse toStartOfWeek: Sunday or Monday (mode 0 vs mode 1)',
    metaDescription:
      'toStartOfWeek(d) starts weeks on Sunday by default (mode 0). Use toStartOfWeek(d, 1) or toMonday(d) for Monday weeks. Return type and gotchas.',
    signature: 'toStartOfWeek(t: Date | DateTime, mode?: UInt8, timezone?: String): Date',
    description:
      'Rounds a Date or DateTime down to the nearest Sunday (mode 0, the default) or Monday (mode 1), and returns a Date.',
    longDescription:
      'toStartOfWeek is used for weekly reporting: weekly active users, week-over-week growth and cohort retention by week. The mode argument sets the first day of the week: mode 0, the default, starts on Sunday, and mode 1 starts on Monday as ISO 8601 does. toMonday(t) is a shorthand for Monday weeks. The result is a Date, with no time component.',
    exampleSql: `-- Monday-start weeks (mode 1). Without the 1, weeks start on Sunday.
SELECT
  toStartOfWeek(created_at, 1) AS week,
  count() AS events
FROM events
GROUP BY week
ORDER BY week DESC
LIMIT 12`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// week: string ("2026-11-02"); events: string (count() is UInt64)
const weekly = await db
  .table('events')
  .select([
    rawAs<string, 'week'>('toStartOfWeek(created_at, 1)', 'week'),
    rawAs<string, 'events'>('count()', 'events'),
  ])
  .groupBy('week')
  .orderBy('week', 'DESC')
  .limit(12)
  .execute();`,
    hypequeryFilename: 'weekly-events.ts',
    pythonExample: `from hypequery.datasets import DatasetQuery, create_dataset_client, dataset, dimension, measure, order
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

events = dataset(
    "events",
    source="events",
    time_key="created_at",
    dimensions={
        "created_at": dimension.timestamp(),
        # Monday-start weeks, as in the SQL example
        "week": dimension.timestamp(sql="toStartOfWeek(created_at, 1)"),
    },
    measures={"events": measure.count("id")},
)

with create_clickhouse_executor(ClickHouseConnection.from_env()) as executor:
    client = create_dataset_client(executor=executor)
    monday = client.execute(events, DatasetQuery(
        dimensions=("week",), order_by=(order.desc("week"),), limit=12,
    ))
    # The built-in week grain is toStartOfWeek(created_at): mode 0, Sunday weeks
    sunday = client.execute(events, DatasetQuery(by="week", order_by=(order.desc("period"),)))

print(monday.data)  # ({'week': '2026-03-02', 'events': 356}, {'week': '2026-02-23', 'events': 144})
print(sunday.data)  # ({'period': '2026-03-01', 'events': 500},)`,
    pythonFilename: 'weekly_events.py',
    pythonNote:
      'The built-in week grain (by="week") compiles to toStartOfWeek(created_at) with mode 0, so it starts weeks on Sunday; declare a dimension with mode 1 for Monday weeks.',
    returnType: 'Date',
    notes: [
      'Mode 0, the default, starts weeks on Sunday. Mode 1 starts them on Monday. For Sunday 2026-11-08, toStartOfWeek(d) returns 2026-11-08 and toStartOfWeek(d, 1) returns 2026-11-02.',
      'toMonday(t) returns the same value as toStartOfWeek(t, 1).',
      'The result is a Date with no time component. Cast with toDateTime(toStartOfWeek(t)) when you need a DateTime.',
      'For retention cohorts, use the same mode on signup_date and event_date, or the weeks will not line up.',
    ],
    relatedFunctions: ['toStartOfDay', 'toStartOfMonth', 'toStartOfInterval', 'toMonday'],
    relatedPillars: [
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
      { href: '/blog/clickhouse-datetime-vs-datetime64-time-zones', label: 'DateTime vs DateTime64 and time zones' },
      { href: '/recipes/iso-week-bucketing', label: 'Recipe: ISO week buckets and %G-W%V labels' },
    ],
    searchIntentCards: [
      {
        title: 'Weekly active users in ClickHouse',
        copy: 'Weekly active users are toStartOfWeek(ts, 1) plus uniqExact(user_id), grouped by week. Pick the mode that matches the week start in your BI tool.',
      },
      {
        title: 'Week-over-week growth in ClickHouse',
        copy: 'Build the weekly series first, then compare each week with the one before it using lagInFrame() over the week column.',
      },
    ],
    faqItems: [
      {
        question: 'Does toStartOfWeek start the week on Monday or Sunday?',
        answer: 'Sunday, by default. toStartOfWeek(t) uses mode 0, which starts weeks on Sunday. Use toStartOfWeek(t, 1) or toMonday(t) for weeks that start on Monday.',
      },
      {
        question: 'What does toStartOfWeek mode 1 mean?',
        answer: 'Mode 1 starts the week on Monday, the ISO 8601 convention. For Sunday 2026-11-08, toStartOfWeek(d, 1) returns 2026-11-02, while toStartOfWeek(d) returns 2026-11-08.',
      },
      {
        question: 'Does toStartOfWeek return a Date or a DateTime?',
        answer: 'A Date, with no time component. Wrap it in toDateTime() if you need to compare or join it with a DateTime column.',
      },
      {
        question: 'What type is toStartOfWeek in TypeScript?',
        answer: 'A string such as "2026-11-02". ClickHouse sends Date values as strings in JSON, and hypequery types them as string.',
      },
    ],
    tsType: 'string ("YYYY-MM-DD")',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/functions/date-time-functions#toStartOfWeek',
    updated: '2026-11-08',
  },

  {
    slug: 'toStartOfMonth',
    name: 'toStartOfMonth',
    cluster: 'date',
    tagline: 'Truncate a DateTime to the first day of the month for MoM reporting.',
    metaTitle: 'ClickHouse toStartOfMonth — TypeScript monthly bucketing',
    metaDescription:
      'toStartOfMonth rounds a DateTime down to the first day of the month. Learn how to use it in TypeScript with hypequery for MoM growth and monthly aggregation.',
    signature: 'toStartOfMonth(datetime: DateTime): Date',
    description:
      'Rounds a DateTime or Date to the first calendar day of its month. Returns a Date. Used for month-over-month comparisons and monthly cohort analysis.',
    longDescription:
      'toStartOfMonth is the go-to function for monthly time-series aggregations: MAU, MoM revenue growth, monthly retention. It normalises any date within a month to the 1st, so GROUP BY toStartOfMonth(ts) produces exactly one row per calendar month.',
    exampleSql: `SELECT
  toStartOfMonth(created_at) AS month,
  count(DISTINCT user_id) AS mau
FROM events
WHERE created_at >= today() - 365
GROUP BY month
ORDER BY month`,
    hypequeryExample: `import { createQueryBuilder, rawAs, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const mau = await db
  .table('events')
  .select([
    selectExpr('toStartOfMonth(created_at)', 'month'),
    rawAs('uniq(user_id)', 'mau'),
  ])
  .where('created_at', 'gte', new Date(Date.now() - 365 * 86400 * 1000))
  .groupBy('month')
  .orderBy('month', 'ASC')
  .execute();`,
    hypequeryFilename: 'monthly-active-users.ts',
    returnType: 'Date',
    notes: [
      'Returns a Date (year-month-01), not a DateTime.',
      'For fiscal months that don\'t align with calendar months, use toStartOfInterval with a INTERVAL expression.',
      'toRelativeMonthNum is useful when you need an integer month index for array operations.',
    ],
    relatedFunctions: ['toStartOfDay', 'toStartOfWeek', 'toStartOfQuarter', 'toStartOfYear'],
    relatedPillars: [
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
      { href: '/clickhouse-saas-analytics', label: 'SaaS Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'Monthly active users ClickHouse query',
        copy: 'GROUP BY toStartOfMonth(event_time), COUNT(DISTINCT user_id) gives you MAU per month. Add a WHERE clause to limit to the last 12 months.',
      },
      {
        title: 'Month-over-month growth ClickHouse',
        copy: 'Self-join on toStartOfMonth offset by 1 month, or use lagInFrame in a window function over the monthly aggregation.',
      },
    ],
    faqItems: [
      {
        question: 'What does toStartOfMonth return?',
        answer: 'A Date value set to the first day of the month (e.g. 2024-03-01) in the column\'s time zone.',
      },
    ],
  },

  {
    slug: 'toStartOfQuarter',
    name: 'toStartOfQuarter',
    cluster: 'date',
    tagline: 'Round a DateTime to the first day of the quarter for QoQ reporting.',
    metaTitle: 'ClickHouse toStartOfQuarter — TypeScript quarterly bucketing',
    metaDescription:
      'toStartOfQuarter truncates a DateTime to the first day of the calendar quarter (Jan 1, Apr 1, Jul 1, Oct 1). Use it in TypeScript with hypequery for QoQ analysis.',
    signature: 'toStartOfQuarter(datetime: DateTime): Date',
    description:
      'Rounds a DateTime or Date down to the first day of its calendar quarter: Jan 1, Apr 1, Jul 1, or Oct 1. Returns a Date. Used for quarterly business reporting.',
    longDescription:
      'toStartOfQuarter is essential for enterprise and SaaS analytics where business targets are quarterly: ARR growth, quarterly churn, Q-o-Q retention. It buckets any date into one of four annual quarters so GROUP BY produces one row per quarter.',
    exampleSql: `SELECT
  toStartOfQuarter(closed_at) AS quarter,
  sum(arr) AS quarterly_arr
FROM deals
GROUP BY quarter
ORDER BY quarter`,
    hypequeryExample: `import { createQueryBuilder, rawAs, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const qArr = await db
  .table('deals')
  .select([
    selectExpr('toStartOfQuarter(closed_at)', 'quarter'),
    rawAs('sum(arr)', 'quarterly_arr'),
  ])
  .groupBy('quarter')
  .orderBy('quarter', 'ASC')
  .execute();`,
    hypequeryFilename: 'quarterly-arr.ts',
    returnType: 'Date',
    notes: [
      'Calendar quarters only — Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec. Fiscal quarter offsets need manual arithmetic.',
      'Combine with toStartOfYear for year-over-year quarterly comparisons.',
    ],
    relatedFunctions: ['toStartOfMonth', 'toStartOfYear', 'toStartOfInterval', 'toQuarter'],
    relatedPillars: [
      { href: '/clickhouse-saas-analytics', label: 'SaaS Analytics' },
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse quarterly aggregation',
        copy: 'toStartOfQuarter maps every date to one of four dates per year. GROUP BY on the result gives quarterly totals directly.',
      },
      {
        title: 'Quarter-over-quarter growth ClickHouse',
        copy: 'Use toStartOfQuarter in a self-join or window function to compare each quarter\'s metric against the previous one.',
      },
    ],
    faqItems: [
      {
        question: 'Does ClickHouse support fiscal quarters?',
        answer: 'Not natively. For fiscal quarters offset from calendar quarters, add the offset in days before calling toStartOfQuarter, or use toStartOfInterval with a custom INTERVAL.',
      },
    ],
  },

  {
    slug: 'toStartOfInterval',
    name: 'toStartOfInterval',
    cluster: 'date',
    tagline: 'Bucket timestamps by any interval: 100 milliseconds, 5 minutes, 2 weeks.',
    metaTitle: 'ClickHouse toStartOfInterval: return types, DateTime64 and week buckets',
    metaDescription:
      'toStartOfInterval returns DateTime, Date or DateTime64 depending on the interval. Why a DateTime64 column comes back as DateTime, how sub-second buckets work, and where week buckets start.',
    signature: 'toStartOfInterval(t, INTERVAL n unit [, origin | timezone])',
    description:
      'Rounds a timestamp down to the start of an interval of any length. SECOND to YEAR work on any timestamp; MILLISECOND, MICROSECOND and NANOSECOND need a DateTime64.',
    longDescription:
      'toStartOfInterval covers the granularities the fixed functions (toStartOfDay, toStartOfWeek and the rest) do not: 5-minute buckets for monitoring charts, 15-minute heatmaps, 2-week billing cycles. Its return type depends on the interval, which matters when the result feeds a join, a comparison or a typed API. The optional third argument is either an origin timestamp, which anchors the buckets, or a time zone name.',
    exampleSql: `-- 5-minute buckets over the last hour
SELECT
  toStartOfInterval(created_at, INTERVAL 5 MINUTE) AS bucket,
  count() AS events
FROM events
WHERE created_at >= now() - INTERVAL 1 HOUR
GROUP BY bucket
ORDER BY bucket;

-- Keep milliseconds: sub-second intervals on a DateTime64 column return DateTime64
SELECT toStartOfInterval(ts64, INTERVAL 100 MILLISECOND) AS bucket, count() AS events
FROM spans
GROUP BY bucket;`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// bucket: string (DateTime); events: string (count() is UInt64)
const fiveMin = await db
  .table('events')
  .select([
    rawAs<string, 'bucket'>('toStartOfInterval(created_at, INTERVAL 5 MINUTE)', 'bucket'),
    rawAs<string, 'events'>('count()', 'events'),
  ])
  // Compute the cutoff in ClickHouse so it uses the column's own time zone
  .where((expr) => expr.raw('created_at >= now() - INTERVAL 1 HOUR'))
  .groupBy('bucket')
  .orderBy('bucket', 'ASC')
  .execute();`,
    hypequeryFilename: 'five-minute-buckets.ts',
    returnType: 'DateTime (SECOND to DAY), Date (WEEK to YEAR), DateTime64 (sub-second)',
    notes: [
      'The return type depends on the interval: SECOND, MINUTE, HOUR and DAY return DateTime; WEEK, MONTH, QUARTER and YEAR return Date; MILLISECOND, MICROSECOND and NANOSECOND return DateTime64. With an origin argument, the result is a DateTime.',
      'A DateTime64 column bucketed by SECOND, MINUTE, HOUR or DAY comes back as DateTime, so the fraction of a second is dropped; WEEK to YEAR return Date. Checked on ClickHouse 26.6.',
      'Sub-second intervals only work on DateTime64. On a DateTime column they fail with ILLEGAL_TYPE_OF_ARGUMENT.',
      'Without an origin, week buckets start on Monday.',
      'The third argument can be a time zone instead of an origin: toStartOfInterval(t, INTERVAL 1 HOUR, \'Asia/Kolkata\').',
    ],
    relatedFunctions: ['toStartOfDay', 'toStartOfWeek', 'toStartOfMinute', 'toStartOfHour'],
    relatedPillars: [
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
      { href: '/clickhouse-real-time-analytics', label: 'Real-Time Analytics' },
      { href: '/clickhouse-dashboard', label: 'ClickHouse Dashboard' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse 5-minute buckets',
        copy: 'toStartOfInterval(ts, INTERVAL 5 MINUTE) groups events into 5-minute windows for monitoring dashboards and rate charts.',
      },
      {
        title: 'Custom time buckets in ClickHouse',
        copy: 'When toStartOfDay and toStartOfHour are too coarse or too fine, pass any INTERVAL n UNIT. Check the return type if the bucket feeds a join.',
      },
    ],
    faqItems: [
      {
        question: 'Why does toStartOfInterval return DateTime for a DateTime64 column?',
        answer: 'For SECOND, MINUTE, HOUR and DAY intervals, toStartOfInterval returns DateTime even when the input is DateTime64, so the fraction of a second is dropped. WEEK, MONTH, QUARTER and YEAR return Date. Only sub-second intervals (MILLISECOND, MICROSECOND, NANOSECOND) return DateTime64. This is current behaviour, checked on ClickHouse 26.6.',
      },
      {
        question: 'What intervals does toStartOfInterval support?',
        answer: 'SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER and YEAR on any timestamp, plus MILLISECOND, MICROSECOND and NANOSECOND on DateTime64 values.',
      },
      {
        question: 'Which day do week buckets start on?',
        answer: 'Monday, when you pass no origin. To start weeks on another day, pass an origin on that weekday: toStartOfInterval(ts, INTERVAL 1 WEEK, toDateTime(\'2024-01-06 00:00:00\')) starts weeks on Saturday.',
      },
      {
        question: 'What type does toStartOfInterval return in TypeScript?',
        answer: 'A string. hypequery types Date, DateTime and DateTime64 values as strings, so pass the type when you select the expression: rawAs<string, \'bucket\'>(...).',
      },
    ],
    tsType: 'string',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/functions/date-time-functions#toStartOfInterval',
    updated: '2026-11-08',
  },

  {
    slug: 'now',
    name: 'now',
    cluster: 'date',
    tagline: 'Return the current server DateTime — the anchor for relative time filters.',
    metaTitle: 'ClickHouse now() — current DateTime in TypeScript',
    metaDescription:
      'ClickHouse now() returns the current server DateTime. Use it in TypeScript with hypequery for relative date filters like the last 7 days, last hour, or since midnight.',
    signature: 'now(): DateTime',
    description:
      'Returns the current server DateTime at query execution time. Used as the anchor point for relative time range filters and as a default value for inserted rows.',
    longDescription:
      'now() is called once per query (not once per row), making it safe and efficient for WHERE clause filtering. Combining now() with INTERVAL arithmetic covers almost all relative time window queries: last N hours, rolling 30 days, since start of today. It always returns server time — if your ClickHouse cluster is set to UTC, now() returns UTC.',
    exampleSql: `-- Last 24 hours
SELECT count() FROM events
WHERE created_at >= now() - INTERVAL 24 HOUR

-- Since midnight today
SELECT count() FROM events
WHERE created_at >= toStartOfDay(now())`,
    hypequeryExample: `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const recent = await db
  .table('events')
  .select(['id', 'user_id', 'created_at'])
  .where((expr) => expr.raw('created_at >= now() - INTERVAL 7 DAY'))
  .orderBy('created_at', 'DESC')
  .limit(1000)
  .execute();`,
    hypequeryFilename: 'recent-events.ts',
    returnType: 'DateTime',
    notes: [
      'now() is evaluated once per query, not per row — safe for partition pruning.',
      'now64() provides sub-second precision (returns DateTime64).',
      'today() returns just the current Date (no time); yesterday() returns yesterday\'s Date.',
      'For reproducible tests, replace now() with a fixed timestamp.',
    ],
    relatedFunctions: ['today', 'yesterday', 'now64', 'toStartOfDay'],
    relatedPillars: [
      { href: '/clickhouse-real-time-analytics', label: 'Real-Time Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse last 7 days filter',
        copy: 'WHERE created_at >= now() - INTERVAL 7 DAY is the idiomatic ClickHouse pattern. In hypequery, pass a JavaScript Date calculated from Date.now().',
      },
      {
        title: 'ClickHouse current timestamp',
        copy: 'now() gives you the server DateTime. now64() gives microsecond precision. today() gives just the date.',
      },
    ],
    faqItems: [
      {
        question: 'Is now() evaluated per row or per query?',
        answer: 'Per query. It is called once when the query starts executing, so all rows in the same query see the same timestamp.',
      },
      {
        question: 'How do I get millisecond precision?',
        answer: 'Use now64() which returns DateTime64(3) — milliseconds. Or now64(6) for microseconds.',
      },
    ],
  },

  {
    slug: 'toDate',
    name: 'toDate',
    cluster: 'date',
    tagline: 'Convert a DateTime, string or number to a Date, and know which inputs it clamps.',
    metaTitle: 'ClickHouse toDate: strings, DateTime and the 1970–2149 range',
    metaDescription:
      'toDate converts a DateTime, a date string or a number to Date. Dates before 1970 or after 2149-06-06 are clamped silently; use toDate32 for those.',
    signature: 'toDate(value: String | DateTime | DateTime64 | Int [, timezone]): Date',
    description:
      'Converts a DateTime, a date string or a number to a Date. Date covers 1970-01-01 to 2149-06-06; values outside that range are clamped without an error.',
    longDescription:
      'toDate drops the time from a DateTime, parses a date string, or turns a number into a date. Small integers are read as days since 1970-01-01 and large ones as Unix timestamps: toDate(19000) is 2022-01-08 and toDate(1700000000) is 2023-11-14. The Date type stores days from 1970-01-01 to 2149-06-06, and toDate clamps anything outside that range, so a birth date in 1969 becomes 1970-01-01. Use toDate32 (1900 to 2299) for those values.',
    exampleSql: `-- Count events per day
SELECT toDate(created_at) AS day, count() AS events
FROM events
GROUP BY day
ORDER BY day;

-- Two full days, whatever the time of day
SELECT count() FROM events
WHERE toDate(created_at) BETWEEN '2026-03-01' AND '2026-03-02';`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// day: string ("2026-03-01"); events: string (count() is UInt64)
const daily = await db
  .table('events')
  .select([rawAs<string, 'day'>('toDate(created_at)', 'day')])
  .count('id', 'events')
  .where((expr) => expr.raw("toDate(created_at) BETWEEN '2026-03-01' AND '2026-03-02'"))
  .groupBy('day')
  .orderBy('day', 'ASC')
  .execute();`,
    hypequeryFilename: 'daily-events.ts',
    pythonExample: `from hypequery.datasets import DatasetQuery, create_dataset_client, dataset, dimension, filter, measure, order
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

events = dataset(
    "events",
    source="events",
    dimensions={"day": dimension.timestamp(sql="toDate(created_at)")},
    measures={"events": measure.count("id")},
)

with create_clickhouse_executor(ClickHouseConnection.from_env()) as executor:
    client = create_dataset_client(executor=executor)
    # Count events per day
    daily = client.execute(events, DatasetQuery(dimensions=("day",), order_by=(order.asc("day"),)))
    # Two full days, whatever the time of day
    two_days = client.execute(events, DatasetQuery(
        filters=(filter.between("day", "2026-03-01", "2026-03-02"),),
    ))

print(daily.data)  # ({'day': '2026-03-01', 'events': 144}, {'day': '2026-03-02', 'events': 144}, ...)
print(two_days.data)  # ({'events': 288},)`,
    pythonFilename: 'daily_events.py',
    pythonNote:
      'The built-in day grain (by="day") compiles to toStartOfDay and returns a DateTime such as "2026-03-01 00:00:00", so this example declares a toDate dimension to get Date values.',
    returnType: 'Date',
    notes: [
      'Filtering a DateTime column with date strings cuts off the last day: created_at BETWEEN \'2026-03-01\' AND \'2026-03-02\' stops at 2026-03-02 00:00:00. In our check it returned 2,881 rows where toDate(created_at) BETWEEN the same dates returned 5,760.',
      'toDate(created_at) on a sorting-key column still uses the primary key: on 2 million rows, toDate(created_at) = \'2026-03-01\' read the same 16,384 rows as an explicit time range.',
      'Values outside 1970-01-01 to 2149-06-06 are clamped silently: toDate(\'1969-12-31\') returns 1970-01-01. Use toDate32 for wider ranges.',
      'Strings in 2024/01/02 and 20240103 form parse on ClickHouse 26.6. US order such as 01/02/2024 fails with CANNOT_PARSE_DATE.',
      'A time zone argument changes which day a DateTime falls on: toDate(created_at, \'America/New_York\').',
    ],
    relatedFunctions: ['toStartOfWeek', 'toStartOfInterval', 'formatDateTime', 'toString'],
    relatedPillars: [
      { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
      { href: '/blog/clickhouse-datetime-vs-datetime64-time-zones', label: 'DateTime vs DateTime64 and time zones' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse DateTime to Date',
        copy: 'toDate(created_at) drops the time. Pass a time zone, toDate(created_at, \'Europe/London\'), when the day should follow a user\'s local calendar.',
      },
      {
        title: 'Date ranges in ClickHouse',
        copy: 'Compare toDate(created_at) with date strings, or compare created_at with a half-open range (>= start AND < next day). BETWEEN with date strings on a DateTime column drops the last day.',
      },
    ],
    faqItems: [
      {
        question: 'How do I convert a DateTime to a Date in ClickHouse?',
        answer: 'toDate(created_at). It uses the column\'s time zone to decide the day unless you pass one: toDate(created_at, \'UTC\').',
      },
      {
        question: 'Why does toDate return 1970-01-01 for my date?',
        answer: 'The Date type starts at 1970-01-01, and toDate clamps earlier values without an error. Use toDate32, which covers 1900 to 2299.',
      },
      {
        question: 'What string formats does toDate accept?',
        answer: 'On ClickHouse 26.6, ISO dates (2024-01-01), slashes (2024/01/02) and compact dates (20240103) all parse. US order such as 01/02/2024 fails, so parse those with parseDateTimeBestEffortUS.',
      },
      {
        question: 'Does wrapping a column in toDate stop ClickHouse using the index?',
        answer: 'No. toDate is monotonic, and in our check WHERE toDate(created_at) = \'2026-03-01\' on a table ordered by created_at read the same 16,384 rows as an explicit time range.',
      },
    ],
    tsType: 'string ("YYYY-MM-DD")',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/functions/type-conversion-functions#toDate',
    updated: '2026-11-08',
  },

  {
    slug: 'formatDateTime',
    name: 'formatDateTime',
    cluster: 'date',
    tagline: 'Format a date as a string with MySQL-style % directives. %M is the month name; %i is minutes.',
    metaTitle: 'ClickHouse formatDateTime: %M is month, %i is minutes, ISO weeks',
    metaDescription:
      'In ClickHouse formatDateTime, %M prints the month name and %i prints minutes. How to format ISO weeks with %G-W%V, weekday names with %W, and time zones.',
    signature: 'formatDateTime(t: Date | DateTime, format: String, [timezone: String]): String',
    description:
      'Formats a Date or DateTime as a String using % directives. Two differ from strftime: %M is the full month name and %i is minutes.',
    longDescription:
      'formatDateTime produces display labels for charts, exports and reports. The directives follow MySQL more than strftime: %Y year, %m month, %d day, %H hour, %i minute, %S second, %M full month name, %b short month name, %W weekday name, %u weekday number (1 is Monday), %V ISO week number, %G ISO week-based year and %j day of year. The time zone argument changes how the value is displayed, not the stored value.',
    exampleSql: `SELECT
  formatDateTime(created_at, '%Y-%m') AS month_label,
  formatDateTime(created_at, '%G-W%V') AS iso_week,
  count() AS events
FROM events
GROUP BY month_label, iso_week
ORDER BY month_label, iso_week`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// month_label: string ("2026-11"); events: string (count() is UInt64)
const labels = await db
  .table('events')
  .select([
    rawAs<string, 'month_label'>("formatDateTime(created_at, '%Y-%m')", 'month_label'),
    rawAs<string, 'events'>('count()', 'events'),
  ])
  .groupBy('month_label')
  .orderBy('month_label', 'ASC')
  .execute();`,
    hypequeryFilename: 'monthly-labels.ts',
    pythonExample: `import os

import clickhouse_connect

client = clickhouse_connect.get_client(dsn=os.environ["CLICKHOUSE_URL"])

# The format strings are bound server-side as {name:String} parameters
result = client.query(
    """
    SELECT
      formatDateTime(created_at, {month_format:String}) AS month_label,
      formatDateTime(created_at, {week_format:String}) AS iso_week,
      count() AS events
    FROM events
    GROUP BY month_label, iso_week
    ORDER BY month_label, iso_week
    """,
    parameters={"month_format": "%Y-%m", "week_format": "%G-W%V"},
)
for row in result.named_results():
    print(row)  # {'month_label': '2026-03', 'iso_week': '2026-W09', 'events': 144}`,
    pythonFilename: 'monthly_labels.py',
    pythonNote:
      'The Python SDK (hypequery 0.1.0b3) has no query builder, so this example sends the SQL through the clickhouse-connect driver directly, with {name:Type} parameters bound on the server.',
    returnType: 'String',
    notes: [
      '%M prints the full month name ("January"). Minutes are %i. Writing %H:%M:%S for a time is the most common mistake. Checked on ClickHouse 26.6.',
      '%W prints the weekday name ("Friday"), not a week number.',
      'For ISO weeks, pair %V with %G, not %Y: formatDateTime(t, \'%G-W%V\') returns "2026-W53" for 2027-01-01.',
      'Sort on the underlying DateTime, or on toStartOfMonth, not on the formatted string.',
      '%F is shorthand for %Y-%m-%d.',
    ],
    relatedFunctions: ['toDate', 'toStartOfMonth', 'toStartOfWeek', 'toString'],
    relatedPillars: [
      { href: '/clickhouse-dashboard', label: 'ClickHouse Dashboard' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/blog/clickhouse-datetime-vs-datetime64-time-zones', label: 'DateTime vs DateTime64 and time zones' },
      { href: '/recipes/iso-week-bucketing', label: 'Recipe: ISO week buckets and %G-W%V labels' },
    ],
    searchIntentCards: [
      {
        title: 'Format a date as a string in ClickHouse',
        copy: 'formatDateTime(ts, \'%F\') gives an ISO date string. Use \'%b %Y\' for chart labels such as "Nov 2026".',
      },
      {
        title: 'ISO week labels in ClickHouse',
        copy: 'formatDateTime(ts, \'%G-W%V\') gives labels such as "2026-W45" that match ISO week numbering at year boundaries.',
      },
    ],
    faqItems: [
      {
        question: 'Is %M minutes or month in ClickHouse formatDateTime?',
        answer: 'Month. %M prints the full month name, such as "January". Use %i for minutes: formatDateTime(t, \'%H:%i:%S\') returns "09:05:07".',
      },
      {
        question: 'How do I format an ISO week with formatDateTime?',
        answer: 'Use %G for the ISO week-based year and %V for the ISO week number. formatDateTime(t, \'%G-W%V\') returns "2026-W53" for 2027-01-01, where %Y would wrongly give 2027.',
      },
      {
        question: 'What does %W print in formatDateTime?',
        answer: 'The weekday name, such as "Friday". It is not a week number. Use %V for the ISO week number and %u for the weekday number, where 1 is Monday.',
      },
      {
        question: 'Which format directives does formatDateTime support?',
        answer: '%Y year, %m month, %d day, %H hour, %i minute, %S second, %f fractional seconds, %F for %Y-%m-%d, %M month name, %b short month name, %W weekday name, %u weekday number, %V ISO week, %G ISO week-based year and %j day of year, among others.',
      },
    ],
    tsType: 'string',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/functions/date-time-functions#formatDateTime',
    updated: '2026-11-08',
  },

  // ── AGGREGATE CLUSTER ───────────────────────────────────────────────────────
  {
    slug: 'count',
    name: 'count',
    cluster: 'aggregate',
    tagline: 'Count rows or non-NULL values — ClickHouse\'s fastest aggregate.',
    metaTitle: 'ClickHouse count() — row counting in TypeScript',
    metaDescription:
      'ClickHouse count() counts rows or non-NULL values. How count(), count(x) and countIf() differ, with TypeScript examples for event analytics.',
    signature: 'count() | count(column) | countIf(condition)',
    description:
      'Counts the number of rows (count()), non-NULL values in a column (count(col)), or rows matching a condition (countIf). The most common aggregate in analytics queries.',
    longDescription:
      'ClickHouse count() is highly optimised — for count() without a column argument it uses stored row counts and avoids data reading entirely. count(DISTINCT col) is available but use uniq() instead for approximate counts on large datasets as it is orders of magnitude faster. countIf(condition) avoids a subquery when you need conditional counts in a single pass.',
    exampleSql: `-- Total events
SELECT count() FROM events;

-- Non-null events with user_id
SELECT count(user_id) FROM events;

-- Conditional count without subquery
SELECT
  countIf(status = 'paid') AS paid_count,
  countIf(status = 'refunded') AS refunded_count
FROM orders;`,
    hypequeryExample: `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const totals = await db
  .table('events')
  .select(['status'])
  .count('id', 'event_count')
  .groupBy('status')
  .orderBy('event_count', 'DESC')
  .execute();`,
    hypequeryFilename: 'event-counts.ts',
    returnType: 'UInt64',
    notes: [
      'count() (no argument) is the fastest — reads from metadata, not data files.',
      'count(DISTINCT col) is exact but slow on high-cardinality columns. Use uniq(col) for approximations.',
      'countIf(cond) = count() with a WHERE clause but runs in a single scan — useful for pivot-style queries.',
    ],
    relatedFunctions: ['uniq', 'countIf', 'sum', 'avg'],
    relatedPillars: [
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
      { href: '/clickhouse-real-time-analytics', label: 'Real-Time Analytics' },
      { href: '/blog/clickhouse-group-by-typescript', label: 'ClickHouse GROUP BY' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse count rows TypeScript',
        copy: 'In hypequery, execute a query and read .length on the result for row counts, or push count() into the raw SQL expression if you need it server-side.',
      },
      {
        title: 'countIf ClickHouse conditional count',
        copy: 'countIf(condition) lets you calculate multiple conditional aggregates in a single table scan — faster than multiple subqueries.',
      },
    ],
    faqItems: [
      {
        question: 'What is the difference between count() and count(col)?',
        answer: 'count() counts all rows including those with NULLs. count(col) counts only rows where col is not NULL.',
      },
      {
        question: 'Should I use count(DISTINCT col) or uniq(col)?',
        answer: 'Use uniq(col) for large datasets — it uses a HyperLogLog-based approximation that is much faster and uses less memory. count(DISTINCT col) is exact but slow.',
      },
    ],
  },

  {
    slug: 'uniq',
    name: 'uniq',
    cluster: 'aggregate',
    tagline: 'Approximate distinct count — fast cardinality estimation for DAU and unique visitors.',
    metaTitle: 'ClickHouse uniq() — approximate distinct counts',
    metaDescription:
      'ClickHouse uniq() counts distinct values using HyperLogLog approximation. Use it in TypeScript with hypequery for fast DAU, unique visitor, and cardinality queries.',
    signature: 'uniq(column): UInt64',
    description:
      'Returns an approximate count of distinct values using the HyperLogLog algorithm. Typically 2–5% error rate. Up to 10× faster than COUNT(DISTINCT) on large datasets.',
    longDescription:
      'uniq() is ClickHouse\'s recommended function for high-cardinality distinct counts. It uses a 2^17-cell HyperLogLog sketch (512 KB per aggregate state) giving roughly 2% error at the 99th percentile. For lower error rates use uniqExact() (exact, slower) or uniqHLL12() (configurable precision). For AggregatingMergeTree materialised views, use uniqState() and uniqMerge().',
    exampleSql: `-- Daily unique users
SELECT
  toStartOfDay(event_time) AS day,
  uniq(user_id) AS dau
FROM events
GROUP BY day
ORDER BY day DESC
LIMIT 30`,
    hypequeryExample: `import { createQueryBuilder, rawAs, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const dau = await db
  .table('events')
  .select([
    selectExpr('toStartOfDay(event_time)', 'day'),
    rawAs('uniq(user_id)', 'dau'),
  ])
  .groupBy('day')
  .orderBy('day', 'DESC')
  .limit(30)
  .execute();`,
    hypequeryFilename: 'daily-unique-users.ts',
    returnType: 'UInt64',
    notes: [
      'Error rate ≈ 2–5% for most cardinalities. Use uniqExact() when you need 100% accuracy.',
      'For pre-aggregated data in AggregatingMergeTree, use uniqState() on insert and uniqMerge() on read.',
      'uniqCombined() uses less memory with similar accuracy — good for high-fan-out GROUP BY.',
    ],
    relatedFunctions: ['uniqExact', 'uniqCombined', 'count', 'groupArray'],
    relatedPillars: [
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-Tenant Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse distinct users fast query',
        copy: 'uniq(user_id) is the standard way to count unique users in ClickHouse. It is 5–10× faster than COUNT(DISTINCT user_id) on tens-of-millions of rows.',
      },
      {
        title: 'ClickHouse HyperLogLog DAU',
        copy: 'uniq() uses HyperLogLog internally. For materialised DAU views, store the sketch with uniqState() and merge with uniqMerge() at query time.',
      },
    ],
    faqItems: [
      {
        question: 'How accurate is uniq() in ClickHouse?',
        answer: 'Typically within 2–5% of the exact count. If you need exact counts, use uniqExact() — but it is significantly slower and uses more memory.',
      },
      {
        question: 'What is the difference between uniq() and uniqCombined()?',
        answer: 'uniqCombined() uses an array for small cardinalities and switches to HyperLogLog for large ones — lower memory, similar accuracy. Preferred for high-cardinality GROUP BY.',
      },
    ],
  },

  {
    slug: 'sum',
    name: 'sum',
    cluster: 'aggregate',
    tagline: 'Sum a numeric column. Integer sums widen to Int64 or UInt64, which matters in TypeScript.',
    metaTitle: 'ClickHouse sum(): result types, NULLs, overflow and TypeScript',
    metaDescription:
      'ClickHouse sum() widens integers to Int64 or UInt64, returns NULL when every value is NULL, and wraps on overflow. How each case reaches TypeScript and Python.',
    signature: 'sum(column)',
    description:
      'Returns the sum of the non-NULL values in a numeric column. Integer inputs widen to Int64 or UInt64, floats to Float64 and decimals to Decimal(38, S).',
    longDescription:
      'sum() is the core aggregation behind revenue totals and metric roll-ups. Grouped by a date bucket it gives a revenue time series. Its result type is wider than the input, so sum() of an Int32 column is an Int64, and that changes how the value reaches a TypeScript app. For array columns use sumArray() or arraySum().',
    exampleSql: `-- Daily revenue in cents (amount_cents is Int64)
SELECT
  toStartOfDay(created_at) AS day,
  sum(amount_cents) AS revenue_cents,
  count() AS orders
FROM orders
GROUP BY day
ORDER BY day DESC
LIMIT 30`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// revenue_cents is a string: Int64 totals arrive as JSON strings to keep precision
const dailyRevenue = await db
  .table('orders')
  .select([rawAs<string, 'day'>('toStartOfDay(created_at)', 'day')])
  .sum('amount_cents', 'revenue_cents')
  .groupBy('day')
  .orderBy('day', 'DESC')
  .limit(30)
  .execute();

const total = dailyRevenue.reduce((acc, row) => acc + BigInt(row.revenue_cents), 0n);`,
    hypequeryFilename: 'daily-revenue.ts',
    pythonExample: `from hypequery.datasets import DatasetQuery, create_dataset_client, dataset, dimension, filter, measure, order
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

orders = dataset(
    "orders",
    source="orders",
    time_key="created_at",
    dimensions={"created_at": dimension.timestamp(), "status": dimension.string()},
    measures={
        "revenue_cents": measure.sum("amount_cents"),
        # A measure filter compiles to a conditional sum over the same scan
        "refunded_cents": measure.sum("amount_cents", filters=(filter.eq("status", "refunded"),)),
    },
)

with create_clickhouse_executor(ClickHouseConnection.from_env()) as executor:
    client = create_dataset_client(executor=executor)
    result = client.execute(orders, DatasetQuery(
        by="day", order_by=(order.desc("period"),), limit=30,
    ))

for row in result.data:
    print(row)  # {'period': '2026-03-09 00:00:00', 'revenue_cents': 9564, 'refunded_cents': 4784}`,
    pythonFilename: 'daily_revenue.py',
    pythonNote:
      'Int64 sums arrive as Python ints, not strings, and the day grain buckets in the client time zone: UTC unless you pass timezone= to create_dataset_client.',
    returnType: 'Int64 / UInt64 (integers), Float64 (floats), Decimal(38, S) (decimals)',
    notes: [
      'Integer sums widen: sum() of an Int32 column returns Int64, and of a UInt8 column UInt64.',
      'Int64 and UInt64 sums wrap around silently on overflow. Cast to Int128, or sum a wide Decimal, when totals can get that large.',
      'With no rows, sum() returns 0. On a Nullable column where every value is NULL, it returns NULL. sumOrNull() returns NULL for no rows as well.',
      'sum() rejects Array columns. Use sumArray(col) or sum(arraySum(col)).',
    ],
    relatedFunctions: ['sumIf', 'avg', 'count', 'quantile'],
    relatedPillars: [
      { href: '/clickhouse-saas-analytics', label: 'SaaS Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
      { href: '/blog/clickhouse-group-by-typescript', label: 'ClickHouse GROUP BY' },
    ],
    searchIntentCards: [
      {
        title: 'Revenue totals from ClickHouse in TypeScript',
        copy: 'Store money as integer cents or Decimal, sum it grouped by day, and convert the Int64 string with BigInt() in TypeScript.',
      },
      {
        title: 'Totals too large for Int64',
        copy: 'Int64 and UInt64 sums wrap silently on overflow. Cast the column to Int128 or a wide Decimal before summing when totals can exceed 9.2 quintillion.',
      },
    ],
    faqItems: [
      {
        question: 'Does ClickHouse sum() return NULL or 0?',
        answer: '0 when there are no rows. NULL when the column is Nullable and every value is NULL; otherwise NULL values are ignored. Use sumOrNull() if you want NULL when there are no rows too.',
      },
      {
        question: 'What type does ClickHouse sum() return?',
        answer: 'A wider type than the input: Int64 for signed integers, UInt64 for unsigned integers, Float64 for floats and Decimal(38, S) for decimals. sum() of an Int32 column is an Int64.',
      },
      {
        question: 'Why is my ClickHouse sum a string in TypeScript?',
        answer: 'Int64 and UInt64 values can exceed JavaScript\'s safe integer range, so hypequery asks ClickHouse to send them as JSON strings and types .sum() results as string. Convert with BigInt(value), or Number(value) when you know the total is small.',
      },
      {
        question: 'How do I sum an array column in ClickHouse?',
        answer: 'sum() fails on Array columns with "Illegal type Array(...) of argument for aggregate function sum". Use sumArray(col) to add every element across rows, or sum(arraySum(col)).',
      },
    ],
    tsType: 'string (Int64/UInt64) or number (Float64)',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/sum',
    updated: '2026-11-14',
    seeAlso: {
      href: '/clickhouse/functions/sum-if',
      label: 'ClickHouse sumIf()',
      copy: 'Summing only the rows that match a condition? sumIf(amount, status = \'paid\') does it in one scan. The sumIf page covers the -If combinator: countIf, avgIf and quantileIf.',
    },
  },

  {
    slug: 'sumIf',
    name: 'sumIf',
    cluster: 'aggregate',
    tagline: 'Conditional aggregation with the -If combinator: sumIf, countIf, avgIf, quantileIf.',
    metaTitle: 'ClickHouse sumIf and the -If combinator: countIf, avgIf, quantileIf',
    metaDescription:
      'sumIf(col, cond) sums only rows where cond is true. The -If combinator for countIf, avgIf and quantileIf, and the sumArrayIf fix for "Illegal type Array".',
    signature: 'sumIf(column, condition)',
    description:
      'Sums only the rows where the condition is true. -If is a combinator, so countIf, avgIf, uniqIf and quantileIf work the same way.',
    longDescription:
      'An -If aggregate takes one extra argument, a condition, and ignores rows where it is false. That gives several conditional totals from one scan, such as paid and refunded revenue in the same SELECT. For most functions the condition goes after the column. For parametric functions such as quantile, the level stays in the first brackets: quantileIf(0.95)(response_ms, region = \'eu\'). countIf takes only the condition.',
    exampleSql: `SELECT
  toStartOfDay(created_at) AS day,
  sumIf(amount_cents, status = 'paid') AS paid_cents,
  sumIf(amount_cents, status = 'refunded') AS refunded_cents,
  countIf(status = 'refunded') AS refunds,
  quantileIf(0.95)(checkout_ms, status = 'paid') AS p95_checkout_ms
FROM orders
GROUP BY day
ORDER BY day DESC`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// sumIf over Int64 and countIf (UInt64) arrive as strings
const daily = await db
  .table('orders')
  .select([
    rawAs<string, 'day'>('toStartOfDay(created_at)', 'day'),
    rawAs<string, 'paid_cents'>("sumIf(amount_cents, status = 'paid')", 'paid_cents'),
    rawAs<string, 'refunds'>("countIf(status = 'refunded')", 'refunds'),
  ])
  .groupBy('day')
  .orderBy('day', 'DESC')
  .execute();`,
    hypequeryFilename: 'conditional-totals.ts',
    pythonExample: `from hypequery.datasets import DatasetQuery, create_dataset_client, dataset, dimension, filter, measure, order
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

paid = (filter.eq("status", "paid"),)
refunded = (filter.eq("status", "refunded"),)

# Filtered measures compile to sumIf, countIf and quantileIf in one scan
orders = dataset(
    "orders",
    source="orders",
    time_key="created_at",
    dimensions={"created_at": dimension.timestamp(), "status": dimension.string()},
    measures={
        "paid_cents": measure.sum("amount_cents", filters=paid),
        "refunded_cents": measure.sum("amount_cents", filters=refunded),
        "refunds": measure.count("order_id", filters=refunded),
        "p95_checkout_ms": measure.percentile("checkout_ms", 0.95, filters=paid),
    },
)

with create_clickhouse_executor(ClickHouseConnection.from_env()) as executor:
    client = create_dataset_client(executor=executor)
    result = client.execute(orders, DatasetQuery(by="day", order_by=(order.desc("period"),)))

print(result.data[0])  # {'period': '2026-03-09 00:00:00', 'paid_cents': 4780, 'refunds': 4, ...}`,
    pythonFilename: 'conditional_totals.py',
    pythonNote:
      'Each measure filter becomes the -If combinator in the compiled SQL: sumIf, countIf(order_id, ...) and quantileIf(0.95)(...).',
    returnType: 'Same as the base function (sumIf follows sum; countIf is UInt64)',
    notes: [
      'sumIf on an Array column fails with "Illegal type Array(...) of argument for aggregate function sum". Use sumArrayIf(col, cond) or sumIf(arraySum(col), cond).',
      'Combinators stack: sumArrayIf applies -Array and then -If.',
      'When no row matches, sumIf and countIf return 0.',
      'countIf(cond) takes only the condition; the other -If functions take the column first.',
    ],
    relatedFunctions: ['sum', 'count', 'avg', 'quantile'],
    relatedPillars: [
      { href: '/clickhouse-saas-analytics', label: 'SaaS Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'Several conditional totals in one query',
        copy: 'Put one sumIf or countIf per status in the same SELECT to get paid, refunded and pending totals from a single scan.',
      },
      {
        title: 'Conditional percentiles in ClickHouse',
        copy: 'quantileIf(0.95)(latency_ms, region = \'eu\') gives the p95 for one segment. The level goes in the first brackets, the condition after the column.',
      },
    ],
    faqItems: [
      {
        question: 'How do I fix "Illegal type Array(Int64) of argument for aggregate function sum" in sumIf?',
        answer: 'sumIf cannot add up an Array column. Use sumArrayIf(col, cond) to add every element of the matching rows, or sumIf(arraySum(col), cond).',
      },
      {
        question: 'How does the -If combinator work in ClickHouse?',
        answer: 'Add If to any aggregate function name and pass a condition as an extra argument: sumIf(x, cond), avgIf(x, cond), uniqIf(x, cond), quantileIf(0.9)(x, cond). Rows where the condition is false are ignored.',
      },
      {
        question: 'What does sumIf return when no rows match?',
        answer: '0. countIf also returns 0 when no rows match.',
      },
      {
        question: 'Is countIf a number or a string in TypeScript?',
        answer: 'A string. countIf returns UInt64, which hypequery asks ClickHouse to send as a JSON string so large counts keep their precision.',
      },
    ],
    tsType: 'string (Int64/UInt64 sums and countIf)',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/aggregate-functions/combinators#-if',
    updated: '2026-11-08',
  },

  {
    slug: 'avg',
    name: 'avg',
    cluster: 'aggregate',
    tagline: 'Calculate the arithmetic mean — average order value, session duration, latency.',
    metaTitle: 'ClickHouse avg() — average aggregation in TypeScript',
    metaDescription:
      'ClickHouse avg() calculates the arithmetic mean of a numeric column. Use it in TypeScript with hypequery for AOV, p50 latency approximation, and metric averages.',
    signature: 'avg(column): Float64',
    description:
      'Returns the arithmetic mean (sum / count) of non-NULL values in a numeric column. Always returns Float64. Use avgIf(col, cond) for conditional averages in a single pass.',
    longDescription:
      'avg() is the standard mean aggregate for ClickHouse analytics: average order value, average session length, average response time (though quantile() is usually better for latency). It is implemented as sum(col) / count(col) internally. For weighted averages use sumProduct(col, weight) / sum(weight) with raw SQL.',
    exampleSql: `SELECT
  toStartOfDay(created_at) AS day,
  avg(order_value) AS aov,
  avgIf(order_value, channel = 'organic') AS organic_aov
FROM orders
GROUP BY day
ORDER BY day DESC
LIMIT 30`,
    hypequeryExample: `import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const aov = await db
  .table('orders')
  .select([selectExpr('toStartOfDay(created_at)', 'day')])
  .avg('order_value', 'aov')
  .groupBy('day')
  .orderBy('day', 'DESC')
  .limit(30)
  .execute();`,
    hypequeryFilename: 'average-order-value.ts',
    returnType: 'Float64',
    notes: [
      'avg() always returns Float64, even for integer inputs.',
      'For latency/performance metrics, use quantile(0.5)(latency) instead — the median is more robust than the mean.',
      'avgWeighted(value, weight) computes a weighted mean in a single expression.',
    ],
    relatedFunctions: ['sum', 'quantile', 'median', 'avgIf', 'avgWeighted'],
    relatedPillars: [
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-saas-analytics', label: 'SaaS Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'Average order value ClickHouse TypeScript',
        copy: 'avg(order_value) gives AOV per day or cohort. In hypequery, chain .groupBy() on the date bucket and .orderBy() for a clean time series.',
      },
    ],
    faqItems: [
      {
        question: 'When should I use quantile() instead of avg()?',
        answer: 'For latency, load time, or any metric with outliers, use quantile(0.5)(col) for the median. avg() is skewed by outliers and rarely reflects typical user experience.',
      },
    ],
  },

  {
    slug: 'quantile',
    name: 'quantile',
    cluster: 'aggregate',
    tagline: 'Approximate percentiles (p50, p95, p99) for latency and performance metrics.',
    metaTitle: 'ClickHouse percentile: quantile() vs quantileExact (p95, p99)',
    metaDescription:
      'ClickHouse quantile() is approximate: it samples up to 8,192 values per group. When to use quantileExact, quantileTDigest or quantiles() instead.',
    signature: 'quantile(level)(column): Float64',
    description:
      'Estimates the quantile at a level between 0 and 1 from a reservoir sample of up to 8,192 values. quantile(0.95)(latency) is an approximate p95.',
    longDescription:
      'quantile() keeps a random sample of up to 8,192 values per group and computes the quantile from that sample, so on large groups the result is an estimate, and ClickHouse documents it as non-deterministic. For an exact answer use quantileExact(); for a repeatable estimate use quantileDeterministic(); for lower memory on very large groups use quantileTDigest(). To compute several levels at once, use quantiles(0.5, 0.95, 0.99)(col), which reads the data once.',
    exampleSql: `-- p50/p95/p99 response times per hour, in one pass
SELECT
  toStartOfHour(ts) AS hour,
  quantiles(0.50, 0.95, 0.99)(response_ms) AS p50_p95_p99
FROM api_requests
GROUP BY hour
ORDER BY hour DESC
LIMIT 24`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// quantile() returns Float64, which arrives as a JSON number
const latency = await db
  .table('api_requests')
  .select([
    rawAs<string, 'hour'>('toStartOfHour(ts)', 'hour'),
    rawAs<number, 'p50'>('quantile(0.50)(response_ms)', 'p50'),
    rawAs<number, 'p95'>('quantile(0.95)(response_ms)', 'p95'),
    rawAs<number, 'p99'>('quantile(0.99)(response_ms)', 'p99'),
  ])
  .groupBy('hour')
  .orderBy('hour', 'DESC')
  .limit(24)
  .execute();`,
    hypequeryFilename: 'latency-percentiles.ts',
    pythonExample: `from hypequery.datasets import DatasetQuery, create_dataset_client, dataset, dimension, measure, order
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

# measure.percentile(col, level) compiles to quantile(level)(col)
api_requests = dataset(
    "api_requests",
    source="api_requests",
    time_key="ts",
    dimensions={"ts": dimension.timestamp()},
    measures={
        "p50": measure.percentile("response_ms", 0.50),
        "p95": measure.percentile("response_ms", 0.95),
        "p99": measure.percentile("response_ms", 0.99),
    },
)

with create_clickhouse_executor(ClickHouseConnection.from_env()) as executor:
    client = create_dataset_client(executor=executor)
    result = client.execute(api_requests, DatasetQuery(
        by="hour", order_by=(order.desc("period"),), limit=24,
    ))

for row in result.data:
    print(row)  # {'period': '2026-03-01 02:00:00', 'p50': 359.5, 'p95': 485.05, 'p99': 496.21}`,
    pythonFilename: 'latency_percentiles.py',
    pythonNote:
      'measure.percentile compiles to one quantile(level)(col) call per level rather than a single quantiles() call, and the hour grain buckets in the client time zone, UTC by default.',
    returnType: 'Float64',
    notes: [
      'quantile() is approximate on groups larger than its 8,192-value sample. Over 2 million rows in our check, quantile(0.99) returned 99,157 where quantileExact(0.99) returned 98,988.',
      'quantileExact() returns the column\'s own type, not Float64, so over a UInt64 column it returns UInt64, which hypequery receives as a string.',
      'quantiles(0.5, 0.95, 0.99)(col) returns Array(Float64) from one pass over the data.',
      'quantileTDigest() returns Float32 and uses less memory on very large groups.',
      'median(col) is quantile(0.5)(col).',
    ],
    relatedFunctions: ['avg', 'sumIf', 'quantileExact', 'quantiles', 'median'],
    relatedPillars: [
      { href: '/clickhouse-real-time-analytics', label: 'Real-Time Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/blog/clickhouse-group-by-typescript', label: 'ClickHouse GROUP BY' },
      { href: '/recipes/p95-latency', label: 'Recipe: p95 latency per event type' },
    ],
    searchIntentCards: [
      {
        title: 'p99 latency in ClickHouse',
        copy: 'quantile(0.99)(response_ms) grouped by toStartOfHour(ts) gives hourly p99 latency. Use quantileExact() when an SLA report needs the exact value.',
      },
      {
        title: 'Percentiles in TypeScript',
        copy: 'Select quantile expressions with rawAs<number, ...>() in hypequery. Float64 results arrive as numbers; quantileExact over 64-bit integers arrives as strings.',
      },
    ],
    faqItems: [
      {
        question: 'Is ClickHouse quantile() exact?',
        answer: 'No. quantile() works from a reservoir sample of up to 8,192 values, so it is approximate on larger groups, and ClickHouse documents the result as non-deterministic. Use quantileExact() for an exact value, or quantileDeterministic(level)(col, determinator) for a repeatable estimate.',
      },
      {
        question: 'What is the difference between quantile() and quantileExact()?',
        answer: 'quantileExact() looks at every value, so it is exact but uses memory in proportion to the group size. It returns the column\'s type instead of Float64, and returns an actual value instead of interpolating: for the numbers 0 to 999 the median is 500 with quantileExact and 499.5 with quantile.',
      },
      {
        question: 'How do I get p50, p95 and p99 in one ClickHouse query?',
        answer: 'Use quantiles(0.5, 0.95, 0.99)(response_ms). It returns an Array(Float64) with one value per level and reads the data once.',
      },
      {
        question: 'Does ClickHouse have a percentile function?',
        answer: 'No. ClickHouse has no percentile() function. Use quantile(0.95)(col) for the 95th percentile, or median(col) for the 50th.',
      },
    ],
    tsType: 'number (Float64)',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/quantile',
    updated: '2026-11-14',
  },

  {
    slug: 'groupArray',
    name: 'groupArray',
    cluster: 'aggregate',
    tagline: 'Collect a group\'s values into an array. Row order is not guaranteed, so sort explicitly.',
    metaTitle: 'ClickHouse groupArray: keep row order, cap size, type the result',
    metaDescription:
      'groupArray() does not guarantee row order, and arraySort(groupArray(x)) sorts values, not rows. How to keep timestamp order, cap the size, and type the result.',
    signature: 'groupArray([max_size])(column): Array',
    description:
      'Collects the values of a column within each group into an Array. ClickHouse documents the order of the values as indeterminate, and NULL values are skipped.',
    longDescription:
      'groupArray() turns many rows into one array per group, the building block for session paths, event sequences and funnel reconstruction. Because ClickHouse reads data in parallel, the order of the values is not guaranteed. When order matters, collect (timestamp, value) tuples, sort them, and keep the values. groupArray(max_size)(col) caps the array length, and array_agg is an alias.',
    exampleSql: `-- Page paths per session, in timestamp order
SELECT
  session_id,
  arrayMap(x -> x.2, arraySort(groupArray((ts, page_path)))) AS path_sequence
FROM page_views
GROUP BY session_id;

-- At most 5 events per user (whichever 5 are read first)
SELECT
  user_id,
  groupArray(5)(event_name) AS some_events
FROM events
GROUP BY user_id;`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// path_sequence: string[] in timestamp order
const sessions = await db
  .table('page_views')
  .select([
    'session_id',
    rawAs<string[], 'path_sequence'>(
      'arrayMap(x -> x.2, arraySort(groupArray((ts, page_path))))',
      'path_sequence',
    ),
  ])
  .groupBy('session_id')
  .execute();`,
    hypequeryFilename: 'session-paths.ts',
    pythonExample: `import os

import clickhouse_connect

client = clickhouse_connect.get_client(dsn=os.environ["CLICKHOUSE_URL"])

# Page paths per session, in timestamp order
paths = client.query("""
    SELECT
      session_id,
      arrayMap(x -> x.2, arraySort(groupArray((ts, page_path)))) AS path_sequence
    FROM page_views
    GROUP BY session_id
    ORDER BY session_id
""")
for session_id, path_sequence in paths.result_rows:
    print(session_id, path_sequence)  # 0 ['/z', '/m', '/a', ...], a list[str]

# At most n events per user; n is bound server-side
capped = client.query(
    "SELECT user_id, groupArray({n:UInt8})(event_name) AS some_events FROM events GROUP BY user_id ORDER BY user_id",
    parameters={"n": 5},
)
print(capped.result_rows[0])  # (0, ['view', 'click', 'buy', 'view', 'click'])`,
    pythonFilename: 'session_paths.py',
    pythonNote:
      'The Python SDK (hypequery 0.1.0b3) has no query builder, so this example sends the SQL through the clickhouse-connect driver directly, with {name:Type} parameters bound on the server.',
    returnType: 'Array(T)',
    notes: [
      'Row order is not guaranteed. arraySort(groupArray(col)) sorts the values themselves, so page paths come back alphabetically, not in time order.',
      'To keep timestamp order, sort tuples and keep the values: arrayMap(x -> x.2, arraySort(groupArray((ts, col)))).',
      'groupArray(N)(col) keeps the first N values it reads, which are not necessarily the first N by time.',
      'groupArray skips NULL values.',
      'groupArraySorted(N)(col) takes a single column and returns its N smallest values in ascending order.',
    ],
    relatedFunctions: ['arrayJoin', 'arraySort', 'groupArrayMovingAvg', 'arrayReduce'],
    relatedPillars: [
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/blog/clickhouse-array-functions-typescript', label: 'ClickHouse array functions' },
      { href: '/recipes/grouparray-user-timelines', label: 'Recipe: ordered per-user timelines with groupArray' },
    ],
    searchIntentCards: [
      {
        title: 'Collect rows into an array in ClickHouse',
        copy: 'groupArray(column) is the ClickHouse equivalent of array_agg (also available under that name). Use groupArray plus arrayStringConcat for GROUP_CONCAT-style strings.',
      },
      {
        title: 'Session path analysis in ClickHouse',
        copy: 'GROUP BY session_id, collect (ts, page_path) tuples, sort them and keep the paths. The result is a per-session page sequence for path and funnel analysis.',
      },
    ],
    faqItems: [
      {
        question: 'Does groupArray keep the order of rows?',
        answer: 'No. ClickHouse documents the order as indeterminate, because rows are read in parallel. To keep timestamp order, collect (timestamp, value) tuples, sort them, then keep the values: arrayMap(x -> x.2, arraySort(groupArray((ts, page_path)))).',
      },
      {
        question: 'Does arraySort(groupArray(col)) put values in time order?',
        answer: 'No. arraySort sorts the values themselves, so strings come back alphabetically and numbers in ascending order. Sort by the timestamp with the tuple pattern instead.',
      },
      {
        question: 'Can I rely on ORDER BY in a subquery?',
        answer: 'Only sometimes. The ClickHouse docs say the order can be relied on when the data comes from an ordered subquery whose result is small enough. Sorting tuples works at any size.',
      },
      {
        question: 'What type does groupArray return in TypeScript?',
        answer: 'An array of the column\'s TypeScript type: string[] for a String column, number[] for an Int32 column. Pass the type when you select the expression: rawAs<string[], \'paths\'>(...).',
      },
    ],
    tsType: 'T[] (for example string[])',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/grouparray',
    updated: '2026-11-08',
  },

  // ── STRING CLUSTER ──────────────────────────────────────────────────────────
  {
    slug: 'toString',
    name: 'toString',
    cluster: 'string',
    tagline: 'Convert any ClickHouse value to a String, including dates in a chosen time zone.',
    metaTitle: 'ClickHouse toString: numbers, dates and time zones to String',
    metaDescription:
      'toString(x) converts numbers, dates, UUIDs and arrays to String. DateTime becomes "YYYY-MM-DD hh:mm:ss" (no T, no zone); a second argument sets the time zone.',
    signature: 'toString(value [, timezone]): String',
    description:
      'Converts a value of any type to its String form. For Date and DateTime it accepts a time zone as a second argument.',
    longDescription:
      'toString is the general cast to String, the same as CAST(x AS String). Common uses are joining an integer id to a String id, building labels, and sending 64-bit integers to a client as text. Dates come out in ClickHouse\'s own format, "2026-11-08 09:05:07", which is not ISO 8601: there is no "T" and no offset. Use formatDateTime for any other date format.',
    exampleSql: `-- Join on mismatched id types
SELECT e.event_name, u.email
FROM events AS e
JOIN users AS u ON toString(e.user_id) = u.external_id;

-- Dates as strings, in a chosen time zone
SELECT
  toString(created_at) AS server_zone,
  toString(created_at, 'Asia/Tokyo') AS tokyo
FROM events
LIMIT 5;`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// created_utc: string in "YYYY-MM-DD hh:mm:ss" form, rendered in UTC
const orders = await db
  .table('orders')
  .select([
    'order_id',
    rawAs<string, 'created_utc'>("toString(created_at, 'UTC')", 'created_utc'),
  ])
  .limit(100)
  .execute();

// Parse it as UTC on the client
const createdAt = new Date(orders[0].created_utc.replace(' ', 'T') + 'Z');`,
    hypequeryFilename: 'order-display.ts',
    pythonExample: `import os

import clickhouse_connect

client = clickhouse_connect.get_client(dsn=os.environ["CLICKHOUSE_URL"])

# Dates as strings, in a time zone bound server-side
result = client.query(
    """
    SELECT
      toString(created_at) AS server_zone,
      toString(created_at, {tz:String}) AS tokyo
    FROM events
    LIMIT 5
    """,
    parameters={"tz": "Asia/Tokyo"},
)
for server_zone, tokyo in result.result_rows:
    print(server_zone, tokyo)  # 2026-03-01 00:00:00 2026-03-01 09:00:00, both str`,
    pythonFilename: 'timezone_strings.py',
    pythonNote:
      'The Python SDK (hypequery 0.1.0b3) has no query builder, so this example sends the SQL through the clickhouse-connect driver directly, with {name:Type} parameters bound on the server.',
    returnType: 'String',
    notes: [
      'DateTime becomes "2026-11-08 09:05:07" and DateTime64(3) becomes "2026-11-08 09:05:07.120": no "T" and no time zone offset. Pass a time zone as the second argument to control which wall-clock time you get.',
      'Floats are printed in full: toString(0.1 + 0.2) returns "0.30000000000000004". Round first for display: toString(round(0.1 + 0.2, 2)) returns "0.3".',
      'toString(NULL) returns NULL, not the string "NULL".',
      'UInt64 values keep every digit: toString(toUInt64(18446744073709551615)) returns "18446744073709551615".',
      'For other date formats use formatDateTime.',
    ],
    relatedFunctions: ['formatDateTime', 'toDate', 'multiIf', 'sum'],
    relatedPillars: [
      { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      { href: '/clickhouse-schema', label: 'ClickHouse Schema' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse int to string',
        copy: 'toString(user_id) or CAST(user_id AS String). Use it to join an integer id with a String id stored in another table.',
      },
      {
        title: 'ClickHouse date to string',
        copy: 'toString(created_at, \'UTC\') gives "YYYY-MM-DD hh:mm:ss" in UTC. formatDateTime(created_at, \'%F\') gives just the date.',
      },
    ],
    faqItems: [
      {
        question: 'What is the difference between toString() and CAST(x AS String)?',
        answer: 'For converting a value to String they give the same result. toString also takes a time zone as a second argument for Date and DateTime values.',
      },
      {
        question: 'Does toString return an ISO 8601 date?',
        answer: 'No. A DateTime becomes "2026-11-08 09:05:07", with a space instead of "T" and no offset. To parse it in JavaScript, render it in a known zone (toString(ts, \'UTC\')) and add the "T" and "Z" yourself, or use formatDateTime.',
      },
      {
        question: 'How do I convert a DateTime to a string in another time zone?',
        answer: 'Pass the zone as the second argument: toString(created_at, \'Asia/Tokyo\'). The stored value does not change, only how it is printed.',
      },
    ],
    tsType: 'string',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/functions/type-conversion-functions#toString',
    updated: '2026-11-08',
  },

  {
    slug: 'concat',
    name: 'concat',
    cluster: 'string',
    tagline: 'Concatenate strings — build labels, composite keys, and display values.',
    metaTitle: 'ClickHouse concat() — string concatenation in TypeScript',
    metaDescription:
      'ClickHouse concat() joins two or more strings. Use it in TypeScript with hypequery to build composite display values, slugs, and event labels in your analytics queries.',
    signature: 'concat(s1: String, s2: String, ...): String',
    description:
      'Concatenates two or more strings into a single String. Arguments that are not strings are cast automatically. The || operator is an alias for concat in ClickHouse.',
    longDescription:
      'concat() is straightforward but important for building composite keys and display labels in ClickHouse queries. Use it to build event_category + \'_\' + event_action labels, tenant-prefixed identifiers, or formatted display strings. For array-to-string joins, use arrayStringConcat(arr, separator) instead.',
    exampleSql: `-- Build display label
SELECT concat(first_name, ' ', last_name) AS full_name FROM users

-- Composite event label
SELECT
  concat(category, ':', action) AS event_label,
  count() AS hits
FROM events
GROUP BY event_label
ORDER BY hits DESC
LIMIT 20`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const labels = await db
  .table('events')
  .select([
    rawAs("concat(category, ':', action)", 'event_label'),
  ])
  .count('id', 'hits')
  .groupBy('event_label')
  .orderBy('hits', 'DESC')
  .limit(20)
  .execute();`,
    hypequeryFilename: 'event-labels.ts',
    returnType: 'String',
    notes: [
      'Non-String arguments are cast to String automatically.',
      'For array-to-string, use arrayStringConcat(arr, \',\').',
      'concatWithSeparator(sep, s1, s2, ...) is cleaner when using a consistent separator.',
    ],
    relatedFunctions: ['toString', 'substring', 'splitByString', 'arrayStringConcat'],
    relatedPillars: [
      { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse string concatenation query',
        copy: 'concat(a, b) or the || operator joins strings. concatWithSeparator(sep, s1, s2) is cleaner for building delimited keys.',
      },
    ],
    faqItems: [
      {
        question: 'Does concat() handle NULL values?',
        answer: 'In ClickHouse, NULL in concat produces an empty string for that argument, not a NULL result. This differs from standard SQL.',
      },
    ],
  },

  // ── CONDITIONAL CLUSTER ─────────────────────────────────────────────────────
  {
    slug: 'if',
    name: 'if',
    cluster: 'conditional',
    tagline: 'Inline conditional — the ternary operator of ClickHouse SQL.',
    metaTitle: 'ClickHouse if() — inline conditionals in TypeScript',
    metaDescription:
      'ClickHouse if(cond, then, else) is the inline conditional expression. Use it in TypeScript with hypequery to classify events, map status codes, and build pivots.',
    signature: 'if(condition: UInt8, then: T, else: T): T',
    description:
      'Returns the "then" value when condition is non-zero (true), otherwise returns the "else" value. Equivalent to CASE WHEN cond THEN then ELSE else END but more concise.',
    longDescription:
      'if() is the idiomatic ClickHouse ternary. It evaluates both branches but only returns the matching one — important for performance when branches involve heavy computation. For multi-way branching use multiIf(). For NULL-safe replacement use ifNull() or coalesce(). Combined with sumIf, avgIf, countIf, it avoids the need for CASE WHEN in most analytics patterns.',
    exampleSql: `-- Classify users as new vs returning
SELECT
  if(is_new_user = 1, 'new', 'returning') AS user_type,
  count() AS users
FROM sessions
GROUP BY user_type

-- Conditional revenue
SELECT
  sumIf(amount, status = 'paid') AS paid,
  sumIf(amount, status = 'refunded') AS refunded
FROM orders`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const classified = await db
  .table('sessions')
  .select([
    rawAs("if(is_new_user = 1, 'new', 'returning')", 'user_type'),
  ])
  .count('user_id', 'users')
  .groupBy('user_type')
  .execute();`,
    hypequeryFilename: 'user-classification.ts',
    returnType: 'Same type as then/else branches',
    notes: [
      'Both branches are evaluated — use multiIf() for short-circuit behaviour in expensive branches.',
      'ifNull(col, default) is a specialised shorthand for if(col IS NULL, default, col).',
      'In SELECT, if() can be used to build pivot-like outputs without subqueries.',
    ],
    relatedFunctions: ['multiIf', 'ifNull', 'coalesce', 'nullIf'],
    relatedPillars: [
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse CASE WHEN alternative',
        copy: 'if(cond, a, b) is shorter than CASE WHEN cond THEN a ELSE b END. For multiple branches, use multiIf(cond1, val1, cond2, val2, ..., default).',
      },
    ],
    faqItems: [
      {
        question: 'Does ClickHouse if() short-circuit evaluate?',
        answer: 'No. Both branches are evaluated. For short-circuit behaviour (important when one branch throws on NULL), wrap in multiIf with a NULL guard.',
      },
    ],
  },

  {
    slug: 'multiIf',
    name: 'multiIf',
    cluster: 'conditional',
    tagline: 'ClickHouse\'s CASE WHEN: return the value for the first true condition, with a default.',
    metaTitle: 'ClickHouse multiIf: CASE WHEN, NULL conditions and mixed types',
    metaDescription:
      'multiIf(c1, v1, c2, v2, default) returns the value of the first true condition. NULL conditions count as false; mixing String and number branches returns a Variant.',
    signature: 'multiIf(cond1, then1, cond2, then2, ..., else)',
    description:
      'Evaluates conditions from left to right and returns the value paired with the first true one, or the last argument if none is true. It is the ClickHouse form of CASE WHEN ... THEN ... ELSE.',
    longDescription:
      'multiIf is how most CASE WHEN expressions are written in ClickHouse, for grading scores, mapping status codes or bucketing values. CASE WHEN also works and is rewritten to multiIf. Conditions run in order, and with the default setting short_circuit_function_evaluation = \'enable\' later branches are skipped for rows where an earlier condition matched, so an expression that would fail on those rows (such as dividing by zero) is not evaluated there. The result type is the common type of the branches; branches without one produce a Variant type.',
    exampleSql: `SELECT
  multiIf(
    score >= 90, 'A',
    score >= 80, 'B',
    score >= 70, 'C',
    score >= 60, 'D',
    'F'
  ) AS grade,
  count() AS students
FROM exam_results
GROUP BY grade
ORDER BY grade;

-- Short-circuit: intDiv is not evaluated for the row where number = 0
SELECT multiIf(number = 0, 'zero', intDiv(10, number) > 3, 'big', 'small') AS size
FROM numbers(4);`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// grade: string; students: string (count() is UInt64)
const graded = await db
  .table('exam_results')
  .select([
    rawAs<string, 'grade'>(
      "multiIf(score >= 90, 'A', score >= 80, 'B', score >= 70, 'C', score >= 60, 'D', 'F')",
      'grade',
    ),
  ])
  .count('student_id', 'students')
  .groupBy('grade')
  .execute();`,
    hypequeryFilename: 'grade-classification.ts',
    pythonExample: `import os

import clickhouse_connect

client = clickhouse_connect.get_client(dsn=os.environ["CLICKHOUSE_URL"])

# Grade cutoffs are bound server-side as {name:UInt8} parameters
result = client.query(
    """
    SELECT
      multiIf(
        score >= {a:UInt8}, 'A',
        score >= {b:UInt8}, 'B',
        score >= {c:UInt8}, 'C',
        score >= {d:UInt8}, 'D',
        'F'
      ) AS grade,
      count() AS students
    FROM exam_results
    GROUP BY grade
    ORDER BY grade
    """,
    parameters={"a": 90, "b": 80, "c": 70, "d": 60},
)
print(result.result_rows)  # [('A', 30), ('B', 30), ('C', 30), ('D', 30), ('F', 180)]`,
    pythonFilename: 'grade_classification.py',
    pythonNote:
      'The Python SDK (hypequery 0.1.0b3) has no query builder, so this example sends the SQL through the clickhouse-connect driver directly, with {name:Type} parameters bound on the server.',
    returnType: 'Common type of the branches (Variant if there is none)',
    notes: [
      'A NULL condition counts as false: multiIf(NULL, \'a\', \'b\') returns \'b\'.',
      'If any branch can be NULL, the result is Nullable: multiIf(x > 1, \'x\', NULL) returns Nullable(String).',
      'Mixing a String branch with a number does not fail on ClickHouse 26.6; it returns Variant(String, UInt8). Cast the branches to one type if your code expects a plain string.',
      'Skipping later branches depends on short_circuit_function_evaluation, which is \'enable\' by default. With it set to \'disable\', every branch is evaluated for every row and can throw.',
      'For two branches, if(cond, then, else) is shorter.',
    ],
    relatedFunctions: ['if', 'coalesce', 'sumIf', 'toString'],
    relatedPillars: [
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
      { href: '/recipes/multiif-bucketing', label: 'Recipe: latency and status buckets with multiIf' },
    ],
    searchIntentCards: [
      {
        title: 'CASE WHEN in ClickHouse',
        copy: 'Both CASE WHEN and multiIf work. multiIf(cond1, val1, cond2, val2, default) is shorter and is what ClickHouse runs underneath.',
      },
      {
        title: 'Bucketing values in TypeScript',
        copy: 'Select a multiIf expression with rawAs<string, \'bucket\'>() in hypequery, then group by the alias. Cast the branches to one type so the result stays a string.',
      },
    ],
    faqItems: [
      {
        question: 'What is the ClickHouse equivalent of CASE WHEN?',
        answer: 'multiIf(cond1, then1, cond2, then2, ..., else). CASE WHEN ... THEN ... ELSE ... END also works in ClickHouse and behaves the same way.',
      },
      {
        question: 'How does multiIf handle NULL conditions?',
        answer: 'A NULL condition counts as false, so evaluation moves on to the next condition: multiIf(NULL, \'a\', \'b\') returns \'b\'. If a branch value can be NULL, the result type is Nullable.',
      },
      {
        question: 'Does multiIf short-circuit?',
        answer: 'Yes, with the default setting short_circuit_function_evaluation = \'enable\'. multiIf(number = 0, \'zero\', intDiv(10, number) > 3, \'big\', \'small\') runs without a division-by-zero error. With the setting disabled, every branch is evaluated for every row.',
      },
      {
        question: 'Can multiIf branches return different types?',
        answer: 'Only if they have a common type, such as Int and Float, which gives Float64. On ClickHouse 26.6, a String branch and a number branch produce a Variant(String, UInt8) instead of an error, so cast the branches with toString() or a CAST when you need one type.',
      },
    ],
    tsType: 'string (for String branches)',
    docsUrl: 'https://clickhouse.com/docs/sql-reference/functions/conditional-functions#multiIf',
    updated: '2026-11-08',
  },

  // ── MATH CLUSTER ────────────────────────────────────────────────────────────
  {
    slug: 'round',
    name: 'round',
    cluster: 'math',
    tagline: 'Round a number to N decimal places — clean display values and bucketing.',
    metaTitle: 'ClickHouse round() — numeric rounding in TypeScript',
    metaDescription:
      'ClickHouse round() rounds a Float to N decimal places. Use it in TypeScript with hypequery for display-ready metrics, percentage formatting, and numeric bucketing.',
    signature: 'round(x: Number, [decimals: Int]): Number',
    description:
      'Rounds a numeric value to N decimal places (default 0). Uses banker\'s rounding (round half to even). For always-up rounding use ceil(); for always-down use floor().',
    longDescription:
      'round() is used to clean up Float64 values from avg() and division before displaying them. It also enables numeric bucketing — round(latency, -2) rounds to the nearest 100 for histogram binning. The optional second argument is the number of decimal places (negative values round to tens/hundreds).',
    exampleSql: `SELECT
  round(avg(order_value), 2) AS avg_order_value,
  round(avg(response_ms), 0) AS avg_latency_ms
FROM orders`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const metrics = await db
  .table('orders')
  .select([
    rawAs('round(avg(order_value), 2)', 'avg_order_value'),
  ])
  .execute();`,
    hypequeryFilename: 'rounded-metrics.ts',
    returnType: 'Same type as input',
    notes: [
      'ClickHouse uses banker\'s rounding (half-to-even). Use roundBankers() explicitly if you need documentation clarity.',
      'Negative decimals round to powers of 10: round(1234, -2) = 1200.',
      'roundToExp2(x) rounds to the nearest power of 2 — useful for histogram bins.',
    ],
    relatedFunctions: ['ceil', 'floor', 'truncate', 'abs'],
    relatedPillars: [
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-dashboard', label: 'ClickHouse Dashboard' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse round float to 2 decimal places',
        copy: 'round(avg(col), 2) returns a Float64 rounded to 2 decimal places. Useful for currency display without full Decimal arithmetic.',
      },
    ],
    faqItems: [
      {
        question: 'Does ClickHouse round() use banker\'s rounding?',
        answer: 'Yes. 0.5 rounds to 0 (even), 1.5 rounds to 2 (even). Use roundBankers() to make this explicit, or ceil()/floor() for directional rounding.',
      },
    ],
  },

  {
    slug: 'intDiv',
    name: 'intDiv',
    cluster: 'math',
    tagline: 'Integer division — bucket IDs, page numbers, and fixed-width range grouping.',
    metaTitle: 'ClickHouse intDiv() — integer division for bucketing',
    metaDescription:
      'ClickHouse intDiv(a, b) performs integer division (floor). Use it in TypeScript with hypequery for range bucketing, histogram bins, and fixed-width ID partitioning.',
    signature: 'intDiv(a: Integer, b: Integer): Integer',
    description:
      'Performs integer division, discarding the remainder (equivalent to floor(a/b) for positive numbers). Used for fixed-width range bucketing and histogram construction.',
    longDescription:
      'intDiv() is the idiomatic way to create fixed-width numeric buckets in ClickHouse. intDiv(price, 10) * 10 maps any price to the start of its $10 range. intDiv(user_id, 1000) shards users into groups of 1000. Unlike the / operator which returns Float64 for Integer inputs, intDiv returns an Integer — making it safe for GROUP BY and PARTITION BY.',
    exampleSql: `-- $10 price range histogram
SELECT
  intDiv(order_value, 10) * 10 AS price_bucket,
  count() AS orders
FROM orders
GROUP BY price_bucket
ORDER BY price_bucket`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const histogram = await db
  .table('orders')
  .select([
    rawAs('intDiv(order_value, 10) * 10', 'price_bucket'),
  ])
  .count('order_id', 'orders')
  .groupBy('price_bucket')
  .orderBy('price_bucket', 'ASC')
  .execute();`,
    hypequeryFilename: 'price-histogram.ts',
    returnType: 'Integer (same width as input)',
    notes: [
      'intDiv throws on division by zero — use intDivOrZero() for null-safe behaviour.',
      'For Float inputs, use floor(a / b) instead.',
      'intDiv(id, N) * N gives the lower bound of each N-wide bucket.',
    ],
    relatedFunctions: ['modulo', 'floor', 'round', 'intDivOrZero'],
    relatedPillars: [
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse histogram bucketing',
        copy: 'intDiv(col, bucket_size) * bucket_size maps each value to the lower bound of its bucket. GROUP BY on that expression gives histogram bins.',
      },
    ],
    faqItems: [
      {
        question: 'What happens if I divide by zero with intDiv?',
        answer: 'intDiv throws an exception on division by zero. Use intDivOrZero(a, b) which returns 0 instead of throwing.',
      },
    ],
  },

  {
    "slug": "min",
    "name": "min",
    "cluster": "aggregate",
    "tagline": "Return the smallest value in a group — earliest signup, cheapest order, fastest response.",
    "metaTitle": "ClickHouse min — TypeScript aggregate minimum",
    "metaDescription": "min(column) returns the smallest value in a group. Learn how to use it in TypeScript with hypequery for earliest dates, lowest prices, and fastest latencies.",
    "signature": "min(column: T): T",
    "description": "Returns the minimum value across all rows in a group. Skips NULLs in Nullable columns and returns the same type as the input column.",
    "longDescription": "min is one of the core aggregate functions in ClickHouse. Given a column, it scans every row in the group and returns the single smallest value — the earliest signup date, the cheapest order total, the fastest response time. It works on numbers, dates, and strings, and returns the same type as the column it reads. Paired with GROUP BY it produces one minimum per bucket, which is why it shows up in almost every analytics rollup. When you need the row at the minimum rather than just the value itself, reach for argMin instead.",
    "exampleSql": "SELECT\n  tenant_id,\n  min(created_at) AS first_order,\n  min(total) AS cheapest_order\nFROM orders\nGROUP BY tenant_id\nORDER BY first_order ASC",
    "hypequeryExample": "import { createQueryBuilder } from '@hypequery/clickhouse';\nimport type { IntrospectedSchema } from './schema';\n\nconst db = createQueryBuilder<IntrospectedSchema>({\n  url: process.env.CLICKHOUSE_URL!,\n  username: process.env.CLICKHOUSE_USERNAME!,\n  password: process.env.CLICKHOUSE_PASSWORD,\n  database: process.env.CLICKHOUSE_DATABASE!,\n});\n\nconst firstOrders = await db\n  .table('orders')\n  .select(['tenant_id'])\n  .min('created_at', 'first_order')\n  .min('total', 'cheapest_order')\n  .groupBy('tenant_id')\n  .orderBy('first_order', 'ASC')\n  .execute();",
    "hypequeryFilename": "min-per-tenant.ts",
    "returnType": "Same type as the input column",
    "notes": [
      "Aggregate functions skip NULLs — min ignores NULL values in a Nullable(T) column and returns the smallest non-NULL value.",
      "The return type matches the column: min over a DateTime gives a DateTime, min over a Decimal gives a Decimal.",
      "When you need the row at the minimum rather than the value itself, use argMin(col, argCol) — hypequery exposes it natively as .argMin(col, argCol, alias)."
    ],
    "relatedFunctions": [
      "max",
      "sum",
      "avg",
      "quantile"
    ],
    "relatedPillars": [
      {
        "href": "/clickhouse-analytics",
        "label": "ClickHouse Analytics"
      },
      {
        "href": "/clickhouse-typescript",
        "label": "ClickHouse TypeScript"
      },
      {
        "href": "/clickhouse-query-builder",
        "label": "ClickHouse Query Builder"
      }
    ],
    "searchIntentCards": [
      {
        "title": "GROUP BY min in ClickHouse",
        "copy": "min is the standard aggregate for the smallest value per group. Combine it with GROUP BY tenant_id to get the earliest signup or lowest price for every tenant in one pass."
      },
      {
        "title": "min value vs the row at the minimum",
        "copy": "min(total) tells you the cheapest order amount, but not which order it was. Use argMin(order_id, total) — .argMin() in hypequery — to pull the row sitting at that minimum."
      },
      {
        "title": "ClickHouse min in TypeScript",
        "copy": "hypequery has a native .min('column', 'alias') on the query builder, so you get the aggregate and a fully typed result back without writing raw SQL."
      }
    ],
    "faqItems": [
      {
        "question": "Does ClickHouse min ignore NULL values?",
        "answer": "Yes. Like other aggregate functions, min skips NULLs in a Nullable column and returns the smallest non-NULL value. If every value in the group is NULL, the result is NULL."
      },
      {
        "question": "What type does min return?",
        "answer": "min returns the same type as the column it reads — a DateTime column yields a DateTime, a Decimal yields a Decimal, a String yields the lexicographically smallest String."
      },
      {
        "question": "How do I get the row at the minimum, not just the value?",
        "answer": "Use argMin(returnColumn, minColumn), which returns the value of one column at the row where another is smallest. hypequery exposes it as .argMin('order_id', 'total', 'cheapest_order_id')."
      }
    ]
  },

  {
    "slug": "max",
    "name": "max",
    "cluster": "aggregate",
    "tagline": "Return the maximum value in a column — the go-to aggregate for peaks, latest timestamps, and largest orders.",
    "metaTitle": "ClickHouse max — TypeScript max aggregate",
    "metaDescription": "max(column) returns the largest value in a group. Learn how to use it in TypeScript with hypequery for peak latency, latest event timestamps, and largest-order queries.",
    "signature": "max(x): T",
    "description": "Returns the largest value across the rows in each group. The exact mirror of min. Works on numbers, dates, and strings, and skips NULLs.",
    "longDescription": "max is one of the most common aggregate functions in ClickHouse analytics: it collapses a group of rows down to the single largest value. It works on any orderable type — numbers, DateTime, Date, and strings — so it covers peak latency, the most recent event timestamp, and the largest order in one function. max ignores NULLs, so a Nullable column returns the largest non-NULL value (or NULL if every row is NULL). It pairs naturally with min for range queries, and when you need the row *at* the maximum rather than just the value, reach for argMax instead.",
    "exampleSql": "SELECT\n  tenant_id,\n  max(latency_ms) AS peak_latency,\n  max(created_at) AS last_event\nFROM events\nWHERE created_at >= now() - INTERVAL 7 DAY\nGROUP BY tenant_id\nORDER BY peak_latency DESC\nLIMIT 50",
    "hypequeryExample": "import { createQueryBuilder } from '@hypequery/clickhouse';\nimport type { IntrospectedSchema } from './schema';\n\nconst db = createQueryBuilder<IntrospectedSchema>({\n  url: process.env.CLICKHOUSE_URL!,\n  username: process.env.CLICKHOUSE_USERNAME!,\n  password: process.env.CLICKHOUSE_PASSWORD,\n  database: process.env.CLICKHOUSE_DATABASE!,\n});\n\nconst peaks = await db\n  .table('events')\n  .select(['tenant_id'])\n  .max('latency_ms', 'peak_latency')\n  .max('created_at', 'last_event')\n  .where('created_at', 'gte', '2026-07-13')\n  .groupBy('tenant_id')\n  .orderBy('peak_latency', 'DESC')\n  .limit(50)\n  .execute();",
    "hypequeryFilename": "peak-latency.ts",
    "returnType": "Same type as the input column (Nullable if the column is Nullable)",
    "notes": [
      "max ignores NULLs and returns the largest non-NULL value; it returns NULL only when every row in the group is NULL.",
      "max(created_at) gives you the latest timestamp, but not the other columns from that row — use argMax(other_col, created_at) to fetch the value at the maximum. hypequery exposes this natively as .argMax('other_col', 'created_at', 'alias').",
      "On a ReplacingMergeTree table, the argMax pattern (or .final()) is the standard way to pick the latest version of each key without paying for a full FINAL merge.",
      "max comes back typed by hypequery's generated schema — a max over a UInt64 column arrives as a string in JS, and a max over DateTime arrives as a string, matching ClickHouse's wire format."
    ],
    "relatedFunctions": [
      "min",
      "sum",
      "avg",
      "quantile"
    ],
    "relatedPillars": [
      {
        "href": "/clickhouse-analytics",
        "label": "ClickHouse Analytics"
      },
      {
        "href": "/clickhouse-real-time-analytics",
        "label": "Real-Time Analytics"
      },
      {
        "href": "/clickhouse-query-builder",
        "label": "ClickHouse Query Builder"
      }
    ],
    "searchIntentCards": [
      {
        "title": "Latest value per key in ClickHouse",
        "copy": "max(created_at) finds the most recent timestamp per group, but to grab the row at that timestamp use argMax(status, created_at). hypequery exposes .argMax('status', 'created_at', 'latest_status') natively — the same idiom that deduplicates a ReplacingMergeTree."
      },
      {
        "title": "Peak latency and largest order in TypeScript",
        "copy": "Use .max('latency_ms', 'peak_latency') to get the worst latency per tenant, or .max('total', 'largest_order') for the biggest order. Results are fully typed from your generated schema."
      },
      {
        "title": "max vs argMax in ClickHouse",
        "copy": "max returns the largest value; argMax returns another column's value at the row where a given column is largest. Pick max for the number, argMax when you need the accompanying data."
      }
    ],
    "faqItems": [
      {
        "question": "What does max return in ClickHouse?",
        "answer": "It returns the single largest value across the rows in each group, in the same type as the input column. It works on numbers, dates, and strings, and skips NULLs, returning NULL only when every row is NULL."
      },
      {
        "question": "How do I get the row at the maximum, not just the value?",
        "answer": "Use argMax instead of max: argMax(status, created_at) returns the status from the row with the largest created_at. In hypequery this is .argMax('status', 'created_at', 'latest_status')."
      },
      {
        "question": "How do I use max in hypequery?",
        "answer": "Call the native .max(column, alias) aggregate on the query builder, for example .max('latency_ms', 'peak_latency'), then .groupBy(...) and .execute(). The result column is typed from your generated schema."
      }
    ]
  },

  {
    "slug": "uniqExact",
    "name": "uniqExact",
    "cluster": "aggregate",
    "tagline": "Count distinct values exactly — the precise, memory-heavy counterpart to uniq().",
    "metaTitle": "ClickHouse uniqExact — TypeScript exact distinct count",
    "metaDescription": "uniqExact returns an exact distinct count. Learn when to use it over the faster uniq() in TypeScript with hypequery, and how COUNT(DISTINCT) maps to it.",
    "signature": "uniqExact(column: T): UInt64",
    "description": "Returns the exact number of distinct values in a column. Unlike uniq(), it holds every distinct value in memory, so it is accurate but costly on high-cardinality columns.",
    "longDescription": "uniqExact is the exact-cardinality aggregate in ClickHouse: it computes COUNT(DISTINCT column) with no approximation. To guarantee accuracy it keeps a hash set of every distinct value it sees, which makes it memory-heavy and slower than uniq() on high-cardinality columns like user_id or session_id. Reach for uniqExact only when exactness is a hard requirement — billing, compliance, or invoice reconciliation — and use uniq() for dashboards and exploratory analytics where a small error is acceptable. A useful detail: COUNT(DISTINCT x) maps to uniqExact by default (controlled by the count_distinct_implementation setting), so the two are equivalent unless you change that setting.",
    "exampleSql": "SELECT\n  toStartOfDay(created_at) AS day,\n  uniqExact(user_id) AS exact_users\nFROM events\nGROUP BY day\nORDER BY day DESC\nLIMIT 30",
    "hypequeryExample": "import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';\nimport type { IntrospectedSchema } from './schema';\n\nconst db = createQueryBuilder<IntrospectedSchema>({\n  url: process.env.CLICKHOUSE_URL!,\n  username: process.env.CLICKHOUSE_USERNAME!,\n  password: process.env.CLICKHOUSE_PASSWORD,\n  database: process.env.CLICKHOUSE_DATABASE!,\n});\n\n// Native .countDistinct emits COUNT(DISTINCT col), which resolves to uniqExact by default —\n// so this IS the exact path in hypequery.\nconst exactByDay = await db\n  .table('events')\n  .select([selectExpr('toStartOfDay(created_at)', 'day')])\n  .countDistinct('user_id', 'exact_users')\n  .groupBy('day')\n  .orderBy('day', 'DESC')\n  .limit(30)\n  .execute();\n\n// Or call uniqExact explicitly with selectExpr when you want the function by name:\nconst exactUsers = await db\n  .table('events')\n  .select([selectExpr('uniqExact(user_id)', 'exact_users')])\n  .execute();",
    "hypequeryFilename": "exact-distinct-users.ts",
    "returnType": "UInt64",
    "notes": [
      "uniqExact stores every distinct value in memory, so it can be slow and RAM-hungry on high-cardinality columns — prefer uniq() unless exactness is required.",
      "COUNT(DISTINCT x) compiles to uniqExact by default via the count_distinct_implementation setting, so the two produce identical results.",
      "UInt64 counts come back from ClickHouse as strings in JavaScript — parse before doing arithmetic on the result.",
      "hypequery's .countDistinct('col', 'alias') emits COUNT(DISTINCT col), which is the exact (uniqExact) path; use uniq() via selectExpr for the fast approximate count."
    ],
    "relatedFunctions": [
      "uniq",
      "count",
      "groupArray"
    ],
    "relatedPillars": [
      {
        "href": "/clickhouse-analytics",
        "label": "ClickHouse Analytics"
      },
      {
        "href": "/clickhouse-product-analytics",
        "label": "Product Analytics"
      },
      {
        "href": "/clickhouse-query-builder",
        "label": "ClickHouse Query Builder"
      }
    ],
    "searchIntentCards": [
      {
        "title": "COUNT(DISTINCT) in ClickHouse",
        "copy": "COUNT(DISTINCT x) maps to uniqExact by default via count_distinct_implementation. In hypequery, .countDistinct('user_id', 'exact_users') emits exactly that — an exact distinct count."
      },
      {
        "title": "uniqExact vs uniq",
        "copy": "uniqExact is exact but keeps every value in memory; uniq() is approximate, fast, and fixed-memory. Use uniqExact for billing and compliance, uniq() for dashboards."
      },
      {
        "title": "Exact distinct count in TypeScript",
        "copy": "hypequery gives you both paths with typed results: native .countDistinct for the exact count, or selectExpr('uniqExact(user_id)', 'exact_users') to name the function directly."
      }
    ],
    "faqItems": [
      {
        "question": "What is the difference between uniqExact and uniq in ClickHouse?",
        "answer": "uniqExact returns the exact distinct count by keeping every value in memory, while uniq() returns an approximate count using an HLL-like algorithm with small, fixed memory. Use uniqExact when exactness is required and uniq() when speed matters more than a tiny error."
      },
      {
        "question": "Does COUNT(DISTINCT x) use uniqExact?",
        "answer": "Yes. By default ClickHouse rewrites COUNT(DISTINCT x) to uniqExact(x), controlled by the count_distinct_implementation setting. In hypequery, .countDistinct('col', 'alias') emits COUNT(DISTINCT col), so it takes the exact path."
      },
      {
        "question": "When should I avoid uniqExact?",
        "answer": "Avoid it on high-cardinality columns in latency-sensitive queries — it stores all distinct values and can consume significant memory. Prefer uniq() for dashboards and exploratory analytics unless the count must be exact."
      }
    ]
  },

  {
    "slug": "coalesce",
    "name": "coalesce",
    "cluster": "conditional",
    "tagline": "Return the first non-NULL argument — the standard fix for Nullable(T) columns leaking into results.",
    "metaTitle": "ClickHouse coalesce in TypeScript | NULL fallbacks",
    "metaDescription": "coalesce returns the first non-NULL argument. Use it in TypeScript with hypequery to push defaults for Nullable(T) columns into SQL and drop the T | null from results.",
    "signature": "coalesce(x1: Nullable(T), x2: T, ...): T",
    "description": "Evaluates its arguments left to right and returns the first one that is not NULL. The standard way to substitute a default for a Nullable(T) column so the result never contains NULL.",
    "longDescription": "coalesce is the workhorse for handling nullable columns in ClickHouse. It scans its arguments in order and returns the first non-NULL value, falling back to the next argument whenever the previous one is NULL. In analytics this is how you keep NULLs out of GROUP BY keys, chart labels, and API payloads: coalesce(region, 'unknown') collapses missing regions into a single labelled bucket instead of a separate NULL group. In hypequery this matters even more, because the generated types map a Nullable(T) column to T | null, so TypeScript forces you to handle the null case. Wrapping the column in coalesce at query time pushes the default down into SQL, and the result column comes back as a plain T — no null to reason about downstream.",
    "exampleSql": "SELECT\n  coalesce(region, 'unknown') AS region,\n  count() AS orders,\n  sum(total) AS revenue\nFROM orders\nGROUP BY region\nORDER BY revenue DESC",
    "hypequeryExample": "import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';\nimport type { IntrospectedSchema } from './schema';\n\nconst db = createQueryBuilder<IntrospectedSchema>({\n  url: process.env.CLICKHOUSE_URL!,\n  username: process.env.CLICKHOUSE_USERNAME!,\n  password: process.env.CLICKHOUSE_PASSWORD,\n  database: process.env.CLICKHOUSE_DATABASE!,\n});\n\nconst byRegion = await db\n  .table('orders')\n  .select([selectExpr(\"coalesce(region, 'unknown')\", 'region')])\n  .count('id', 'orders')\n  .sum('total', 'revenue')\n  .groupBy('region')\n  .orderBy('revenue', 'DESC')\n  .execute();",
    "hypequeryFilename": "orders-by-region.ts",
    "returnType": "T (the non-nullable supertype of the arguments)",
    "notes": [
      "All arguments should share a common supertype — coalesce(revenue, 0) is fine, coalesce(name, 0) is not.",
      "For the common two-argument case, ifNull(x, alt) is the shorter equivalent of coalesce(x, alt).",
      "assumeNotNull(x) strips the Nullable wrapper without supplying a default — it is unsafe and returns garbage if the value is actually NULL, so prefer coalesce.",
      "coalesce over a GROUP BY key collapses NULLs into one labelled bucket instead of a separate NULL group."
    ],
    "relatedFunctions": [
      "ifNull",
      "nullIf",
      "assumeNotNull",
      "multiIf"
    ],
    "relatedPillars": [
      {
        "href": "/clickhouse-typescript",
        "label": "ClickHouse TypeScript"
      },
      {
        "href": "/clickhouse-analytics",
        "label": "ClickHouse Analytics"
      },
      {
        "href": "/clickhouse-query-builder",
        "label": "ClickHouse Query Builder"
      }
    ],
    "searchIntentCards": [
      {
        "title": "Replace NULL with a default in ClickHouse",
        "copy": "coalesce(col, fallback) returns the first non-NULL argument, so coalesce(region, 'unknown') swaps every NULL region for a default. It is the standard fix for Nullable(T) columns leaking NULLs into your results."
      },
      {
        "title": "coalesce vs ifNull in ClickHouse",
        "copy": "ifNull(x, alt) is the two-argument shortcut; coalesce(x1, x2, ...) takes any number of fallbacks and returns the first non-NULL. Use ifNull for a single default, coalesce when you have a chain of fallbacks."
      },
      {
        "title": "Handle Nullable columns in TypeScript",
        "copy": "hypequery generates Nullable(T) columns as T | null, so TypeScript forces you to handle the null. Wrapping the column in selectExpr(\"coalesce(col, 'default')\", 'col') pushes the default into SQL and returns a plain, non-nullable T."
      }
    ],
    "faqItems": [
      {
        "question": "What does coalesce return in ClickHouse?",
        "answer": "It evaluates its arguments left to right and returns the first one that is not NULL. If every argument is NULL, the result is NULL, so end the list with a non-nullable default like coalesce(region, 'unknown')."
      },
      {
        "question": "What is the difference between coalesce and ifNull?",
        "answer": "ifNull(x, alt) is the two-argument special case of coalesce. coalesce(x1, x2, ...) accepts any number of arguments and returns the first non-NULL, so reach for it when you have a chain of fallbacks rather than a single default."
      },
      {
        "question": "How do I remove the null from a Nullable column in hypequery?",
        "answer": "hypequery types a Nullable(T) column as T | null. Wrap it in coalesce inside selectExpr — selectExpr(\"coalesce(region, 'unknown')\", 'region') — to push the default into SQL so the result column comes back as a plain, non-nullable T."
      }
    ]
  },

  {
    "slug": "dateDiff",
    "name": "dateDiff",
    "cluster": "date",
    "tagline": "Count calendar-boundary crossings between two dates — not elapsed time, which is the gotcha everyone hits.",
    "metaTitle": "ClickHouse dateDiff — TypeScript date differences",
    "metaDescription": "dateDiff(unit, start, end) counts calendar-boundary crossings between two dates, not elapsed time. Learn the gotcha and use it type-safely in TypeScript.",
    "signature": "dateDiff(unit: String, startdate: DateTime, enddate: DateTime[, timezone: String]): Int64",
    "description": "Returns the number of `unit` boundaries (day, month, year, etc.) crossed between two dates. It counts calendar boundaries, not elapsed time — so 23:59 on Dec 31 to 00:01 on Jan 1 is 1 day.",
    "longDescription": "dateDiff is the function people reach for to answer \"how many days/months/years between these two timestamps?\" — but its behavior surprises almost everyone the first time. It does not measure elapsed duration. It counts how many `unit` boundaries you cross going from the start to the end. dateDiff('day', '2024-12-31 23:59:00', '2025-01-01 00:01:00') returns 1, even though only two minutes elapsed, because a single midnight boundary was crossed. Likewise dateDiff('year', '2024-12-31', '2025-01-01') is 1. This is exactly what you want for questions phrased in calendar terms (\"which billing month is this in?\") and exactly what you don't want for SLA timers or precise durations. When you need complete elapsed units instead, use age(), the complement: age('day', start, end) only counts a day once a full 24 hours has passed. Supported units range from nanosecond through year, and dateDiff has two aliases, date_diff and timestampDiff.",
    "exampleSql": "SELECT\n  region,\n  avg(dateDiff('day', created_at, converted_at)) AS avg_days_to_convert,\n  count() AS conversions\nFROM orders\nWHERE converted_at IS NOT NULL\nGROUP BY region\nORDER BY avg_days_to_convert ASC",
    "hypequeryExample": "import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';\nimport type { IntrospectedSchema } from './schema';\n\nconst db = createQueryBuilder<IntrospectedSchema>({\n  url: process.env.CLICKHOUSE_URL!,\n  username: process.env.CLICKHOUSE_USERNAME!,\n  password: process.env.CLICKHOUSE_PASSWORD,\n  database: process.env.CLICKHOUSE_DATABASE!,\n});\n\nconst conversions = await db\n  .table('orders')\n  .select([\n    'region',\n    selectExpr(\"dateDiff('day', created_at, converted_at)\", 'days_to_convert'),\n  ])\n  .whereNotNull('converted_at')\n  .orderBy('days_to_convert', 'ASC')\n  .execute();",
    "hypequeryFilename": "days-to-convert.ts",
    "returnType": "Int64",
    "notes": [
      "dateDiff counts calendar-boundary crossings, not elapsed time: dateDiff('day', '2024-12-31 23:59:00', '2025-01-01 00:01:00') is 1 despite only two minutes passing.",
      "Use age(unit, start, end) as the complement — it counts complete elapsed units, so the same two-minute span returns 0 days.",
      "The aliases date_diff and timestampDiff are identical to dateDiff; pick one and stay consistent across a codebase.",
      "Supported units run from nanosecond to year; the result is always an Int64.",
      "Pass a fourth timezone argument to control which calendar the boundaries are measured in — this matters for day and larger units near midnight.",
      "In hypequery, wrap the call in selectExpr(\"dateDiff('day', a, b)\", 'alias') inside .select([...]) — it is a raw ClickHouse expression, not a first-class builder method."
    ],
    "relatedFunctions": [
      "toStartOfDay",
      "toDate",
      "now",
      "formatDateTime"
    ],
    "relatedPillars": [
      {
        "href": "/clickhouse-time-series",
        "label": "ClickHouse Time Series"
      },
      {
        "href": "/clickhouse-analytics",
        "label": "ClickHouse Analytics"
      },
      {
        "href": "/clickhouse-product-analytics",
        "label": "ClickHouse Product Analytics"
      }
    ],
    "searchIntentCards": [
      {
        "title": "Days to conversion in ClickHouse",
        "copy": "To measure how long a signup takes to convert, dateDiff('day', created_at, converted_at) gives the day count. Remember it counts midnight crossings, so a signup at 23:00 converting at 01:00 the next day counts as 1 day."
      },
      {
        "title": "Subscription age in months or years",
        "copy": "dateDiff('month', started_at, now()) returns how many month boundaries a subscription has crossed — ideal for billing-cycle and cohort logic where calendar months, not elapsed 30-day windows, are what matter."
      },
      {
        "title": "dateDiff counting wrong for SLA timers",
        "copy": "If your SLA timer over-counts, you are hitting the boundary-crossing behavior: dateDiff('hour', ...) increments at each clock hour, not per 60 elapsed minutes. Use age('hour', start, end) when you need complete elapsed hours instead."
      }
    ],
    "faqItems": [
      {
        "question": "Does dateDiff measure elapsed time between two dates?",
        "answer": "No. dateDiff counts how many `unit` boundaries are crossed between the two dates, not the elapsed duration. dateDiff('day', '2024-12-31 23:59:00', '2025-01-01 00:01:00') returns 1 because one midnight is crossed, even though only two minutes elapsed. Use age() when you need complete elapsed units."
      },
      {
        "question": "What is the difference between dateDiff and age in ClickHouse?",
        "answer": "dateDiff counts calendar-boundary crossings, so a partial unit still counts. age counts only fully completed units, so it returns the same value only once a whole unit of time has actually passed. They are complements: reach for dateDiff for calendar questions and age for precise durations."
      },
      {
        "question": "What units and return type does dateDiff support?",
        "answer": "dateDiff accepts units from nanosecond, microsecond, millisecond, second, minute, hour, day, week, month, quarter, up to year, and always returns an Int64. Its aliases date_diff and timestampDiff behave identically."
      }
    ]
  },

  {
    "slug": "arrayMap",
    "name": "arrayMap",
    "cluster": "array",
    "tagline": "Transform every element of an array with a lambda — no subquery, no UNNEST.",
    "metaTitle": "ClickHouse arrayMap — TypeScript array transforms",
    "metaDescription": "arrayMap applies a lambda to every element of an array. Use it in TypeScript with hypequery to transform values collected by groupArray, no subquery needed.",
    "signature": "arrayMap(func: x -> expr, arr: Array(T)): Array(U)",
    "description": "Applies a lambda function to every element of an array and returns a new array of the transformed results. Uses ClickHouse's higher-order lambda syntax (x -> expr).",
    "longDescription": "arrayMap is ClickHouse's higher-order array transform: you pass a lambda (x -> expr) and an array, and it returns a new array where each element is the result of running the lambda on the original. Because ClickHouse arrays are first-class column values, arrayMap chains naturally with groupArray — collect rows into an array with groupArray, then reshape each value inline without a correlated subquery or a second GROUP BY pass. The multi-array form arrayMap((x, y) -> ..., arr1, arr2) walks several equal-length arrays in lockstep, which is how you combine collected fields (say, prices and quantities) element by element.",
    "exampleSql": "SELECT\n  region,\n  arrayMap(x -> round(x * 1.2, 2), groupArray(price)) AS adjusted_prices\nFROM orders\nGROUP BY region\nORDER BY region",
    "hypequeryExample": "import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';\nimport type { IntrospectedSchema } from './schema';\n\nconst db = createQueryBuilder<IntrospectedSchema>({\n  url: process.env.CLICKHOUSE_URL!,\n  username: process.env.CLICKHOUSE_USERNAME!,\n  password: process.env.CLICKHOUSE_PASSWORD,\n  database: process.env.CLICKHOUSE_DATABASE!,\n});\n\nconst adjusted = await db\n  .table('orders')\n  .select([\n    'region',\n    selectExpr('arrayMap(x -> round(x * 1.2, 2), groupArray(price))', 'adjusted_prices'),\n  ])\n  .groupBy('region')\n  .orderBy('region', 'ASC')\n  .execute();",
    "hypequeryFilename": "adjusted-prices.ts",
    "returnType": "Array(U)",
    "notes": [
      "The lambda uses ClickHouse arrow syntax (x -> expr), not a SQL function name — express it inside selectExpr in hypequery.",
      "The multi-array form arrayMap((x, y) -> x * y, prices, quantities) requires every input array to be the same length or the query errors.",
      "Pair with groupArray to collect rows first, then transform each value inline instead of writing a subquery or second aggregation pass."
    ],
    "relatedFunctions": [
      "groupArray",
      "arrayFilter"
    ],
    "relatedPillars": [
      {
        "href": "/clickhouse-typescript",
        "label": "ClickHouse TypeScript"
      },
      {
        "href": "/clickhouse-analytics",
        "label": "ClickHouse Analytics"
      },
      {
        "href": "/clickhouse-query-builder",
        "label": "ClickHouse Query Builder"
      }
    ],
    "searchIntentCards": [
      {
        "title": "Transform an array in ClickHouse",
        "copy": "arrayMap runs a lambda over every element of an array and returns a new array. Use arrayMap(x -> expr, arr) to convert units, round values, or reshape each element without touching the rest of the query."
      },
      {
        "title": "arrayMap with groupArray",
        "copy": "Collect rows into an array with groupArray, then wrap it in arrayMap to transform each collected value in place — no correlated subquery and no second GROUP BY."
      },
      {
        "title": "ClickHouse arrayMap in TypeScript",
        "copy": "hypequery has no dedicated arrayMap builder method, but selectExpr lets you pass arrayMap(x -> round(x * 1.2, 2), prices) straight into .select([...]) and get typed rows back."
      }
    ],
    "faqItems": [
      {
        "question": "What does arrayMap return in ClickHouse?",
        "answer": "It returns a new array of the same length as the input, where each element is the result of applying the lambda (x -> expr) to the corresponding source element."
      },
      {
        "question": "Can arrayMap work over multiple arrays at once?",
        "answer": "Yes. The multi-array form arrayMap((x, y) -> ..., arr1, arr2) walks several arrays in parallel, so you can combine collected fields element by element. All input arrays must be the same length."
      },
      {
        "question": "How do I use arrayMap in hypequery?",
        "answer": "There is no arrayMap method on the query builder. Pass the expression through selectExpr, for example selectExpr('arrayMap(x -> round(x * 1.2, 2), groupArray(price))', 'adjusted_prices') inside .select([...])."
      }
    ]
  },

  {
    "slug": "arrayFilter",
    "name": "arrayFilter",
    "cluster": "array",
    "tagline": "Keep only the array elements that match a lambda predicate — the array-native WHERE clause.",
    "metaTitle": "ClickHouse arrayFilter — TypeScript array filtering",
    "metaDescription": "arrayFilter keeps array elements where a lambda returns nonzero. Use it in TypeScript with hypequery to filter arrays in one expression, no subquery.",
    "signature": "arrayFilter(func: x -> UInt8, arr: Array(T)): Array(T)",
    "description": "Returns a new array containing only the elements of the input array for which the lambda x -> cond evaluates to a nonzero value. The array-column equivalent of a WHERE clause.",
    "longDescription": "arrayFilter walks an array and keeps every element where the lambda predicate returns nonzero (truthy), dropping the rest. It uses the same x -> expr lambda syntax as arrayMap, so the two pair naturally: filter an array down to the elements you care about, then map over the survivors — all in a single SQL expression, with no subquery or arrayJoin round-trip. Because it operates row-by-row on the array column, it is the idiomatic way to slice event lists, tag arrays, or per-order line items before aggregating with functions like groupArray, sum, or length.",
    "exampleSql": "SELECT\n  order_id,\n  arrayFilter(x -> x > 100, order_values) AS large_orders,\n  length(arrayFilter(x -> x > 100, order_values)) AS large_order_count\nFROM orders\nWHERE has(order_values, 0) = 0\nORDER BY large_order_count DESC\nLIMIT 50",
    "hypequeryExample": "import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';\nimport type { IntrospectedSchema } from './schema';\n\nconst db = createQueryBuilder<IntrospectedSchema>({\n  url: process.env.CLICKHOUSE_URL!,\n  username: process.env.CLICKHOUSE_USERNAME!,\n  password: process.env.CLICKHOUSE_PASSWORD,\n  database: process.env.CLICKHOUSE_DATABASE!,\n});\n\nconst rows = await db\n  .table('orders')\n  .select([\n    'order_id',\n    selectExpr('arrayFilter(x -> x > 100, order_values)', 'large_orders'),\n  ])\n  .orderBy('order_id', 'DESC')\n  .limit(50)\n  .execute();",
    "hypequeryFilename": "large-orders.ts",
    "returnType": "Array(T) — a new array of the same element type, containing only the matching elements",
    "notes": [
      "The lambda must return a nonzero value to keep an element; ClickHouse treats any nonzero number as true, so predicates like x -> x > 100 or x -> x != '' work directly.",
      "arrayFilter uses the same x -> expr lambda syntax as arrayMap, so you can filter then map in one expression — arrayMap(x -> x * 2, arrayFilter(x -> x > 100, order_values)) — without a subquery.",
      "When you only need a boolean or a count rather than the filtered array, reach for the predicate cousins: arrayExists (any element matches), arrayAll (every element matches), and arrayCount (how many match).",
      "In hypequery there is no dedicated array-lambda builder method — pass the whole arrayFilter(...) call through selectExpr(sql, alias) inside .select([...]) and you still get typed results back."
    ],
    "relatedFunctions": [
      "arrayMap",
      "groupArray"
    ],
    "relatedPillars": [
      {
        "href": "/clickhouse-analytics",
        "label": "ClickHouse Analytics"
      },
      {
        "href": "/clickhouse-typescript",
        "label": "ClickHouse TypeScript"
      },
      {
        "href": "/clickhouse-query-builder",
        "label": "ClickHouse Query Builder"
      }
    ],
    "searchIntentCards": [
      {
        "title": "Filter an array column in ClickHouse",
        "copy": "arrayFilter(x -> cond, arr) is the array-native WHERE clause: it returns a new array of only the elements where the lambda is nonzero, leaving the rest of the row untouched."
      },
      {
        "title": "arrayFilter vs arrayMap",
        "copy": "arrayMap transforms every element; arrayFilter drops the ones that fail a predicate. They share the x -> expr lambda syntax, so nest them to filter then transform in a single expression."
      },
      {
        "title": "ClickHouse array filtering in TypeScript",
        "copy": "hypequery has no array-lambda builder method, so pass arrayFilter(x -> x > 100, order_values) through selectExpr inside .select([...]) and get a typed array back on the result row."
      }
    ],
    "faqItems": [
      {
        "question": "What does arrayFilter return?",
        "answer": "A new array of the same element type containing only the elements for which the lambda x -> cond returned a nonzero value. Non-matching elements are removed and the original array is unchanged."
      },
      {
        "question": "How is arrayFilter different from arrayExists or arrayCount?",
        "answer": "arrayFilter returns the filtered array itself, while arrayExists returns 1 if any element matches, arrayAll returns 1 only if every element matches, and arrayCount returns how many matched. Use the predicate versions when you need a boolean or a number instead of the sub-array."
      },
      {
        "question": "Can I use arrayFilter in hypequery's query builder?",
        "answer": "Yes. There is no dedicated array-lambda method, so wrap the full call in selectExpr('arrayFilter(x -> x > 100, order_values)', 'large_orders') inside .select([...]). hypequery passes the raw expression through and still types the returned column."
      }
    ]
  },
];

export const functionsBySlug = Object.fromEntries(
  clickhouseFunctions.map((fn) => [fn.slug, fn]),
) as Record<string, ClickHouseFunctionDef>;

export const functionsByPathSegment = Object.fromEntries(
  clickhouseFunctions.map((fn) => [functionPathSegment(fn.name), fn]),
) as Record<string, ClickHouseFunctionDef>;

export function findFunction(identifier: string): ClickHouseFunctionDef | undefined {
  return functionsBySlug[identifier] ?? functionsByPathSegment[functionPathSegment(identifier)];
}

export const functionsByCluster = clickhouseFunctions.reduce<
  Record<ClickHouseFunctionCluster, ClickHouseFunctionDef[]>
>(
  (acc, fn) => {
    acc[fn.cluster].push(fn);
    return acc;
  },
  { date: [], aggregate: [], string: [], conditional: [], math: [], array: [] },
);
