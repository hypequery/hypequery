export type ClickHouseFunctionCluster = 'date' | 'aggregate' | 'string' | 'conditional' | 'math';

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
  returnType: string;
  notes: string[];
  relatedFunctions: string[];
  relatedPillars: { href: string; label: string }[];
  searchIntentCards: { title: string; copy: string }[];
  faqItems: { question: string; answer: string }[];
};

export const clickhouseFunctions: ClickHouseFunctionDef[] = [
  // ── DATE CLUSTER ────────────────────────────────────────────────────────────
  {
    slug: 'toStartOfDay',
    name: 'toStartOfDay',
    cluster: 'date',
    tagline: 'Truncate a DateTime to midnight — the foundation of daily analytics bucketing.',
    metaTitle: 'ClickHouse toStartOfDay — TypeScript daily bucketing with hypequery',
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
    tagline: 'Round a DateTime to the start of the week — weekly cohort and trend analysis.',
    metaTitle: 'ClickHouse toStartOfWeek — TypeScript weekly bucketing with hypequery',
    metaDescription:
      'toStartOfWeek truncates a DateTime to the first day of the ISO week. Use it in TypeScript with hypequery for weekly trend charts and cohort retention.',
    signature: 'toStartOfWeek(datetime: DateTime, mode?: UInt8): Date',
    description:
      'Rounds a DateTime or Date value down to the start of the calendar week. Mode 0 (default) starts on Monday; mode 1 starts on Sunday.',
    longDescription:
      'toStartOfWeek is used for weekly reporting: weekly active users (WAU), week-over-week growth, and cohort retention by week. The mode argument controls whether the week starts on Monday (ISO 8601, mode 0) or Sunday (US convention, mode 1). Returns a Date, not DateTime.',
    exampleSql: `SELECT
  toStartOfWeek(created_at) AS week,
  count() AS events
FROM events
GROUP BY week
ORDER BY week DESC
LIMIT 12`,
    hypequeryExample: `import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const weekly = await db
  .table('events')
  .select([selectExpr('toStartOfWeek(created_at)', 'week')])
  .count('id', 'events')
  .groupBy('week')
  .orderBy('week', 'DESC')
  .limit(12)
  .execute();`,
    hypequeryFilename: 'weekly-events.ts',
    returnType: 'Date',
    notes: [
      'Returns a Date, not a DateTime — no time component.',
      'Mode 0 = Monday start (ISO), Mode 1 = Sunday start (US/Google Analytics convention).',
      'For retention cohorts, use toStartOfWeek on both signup_date and event_date, then compare.',
    ],
    relatedFunctions: ['toStartOfDay', 'toStartOfMonth', 'toStartOfInterval', 'toMonday'],
    relatedPillars: [
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'Weekly active users in ClickHouse',
        copy: 'WAU is toStartOfWeek + COUNT(DISTINCT user_id). The mode argument lets you match Monday or Sunday week starts to align with your BI tool.',
      },
      {
        title: 'Week-over-week growth ClickHouse',
        copy: 'Calculate WoW by joining the same table on toStartOfWeek offset by 7 days, or use a window function with lagInFrame over the weekly time series.',
      },
    ],
    faqItems: [
      {
        question: 'Does toStartOfWeek return a Date or DateTime?',
        answer: 'It returns a Date (no time component). If you need a DateTime for joins, cast it: toDateTime(toStartOfWeek(ts)).',
      },
      {
        question: 'How do I start the week on Sunday instead of Monday?',
        answer: 'Pass mode=1 as the second argument: toStartOfWeek(created_at, 1).',
      },
    ],
  },

  {
    slug: 'toStartOfMonth',
    name: 'toStartOfMonth',
    cluster: 'date',
    tagline: 'Truncate a DateTime to the first day of the month for MoM reporting.',
    metaTitle: 'ClickHouse toStartOfMonth — TypeScript monthly bucketing with hypequery',
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
    metaTitle: 'ClickHouse toStartOfQuarter — TypeScript quarterly bucketing with hypequery',
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
    tagline: 'Bucket by any arbitrary interval — 5-minute, hourly, bi-weekly, or custom.',
    metaTitle: 'ClickHouse toStartOfInterval — custom time bucketing in TypeScript | hypequery',
    metaDescription:
      'toStartOfInterval rounds a DateTime to the start of any custom interval (5 min, 2 hours, 4 weeks). Use it in TypeScript with hypequery for flexible time bucketing.',
    signature: 'toStartOfInterval(datetime: DateTime, interval: Interval, [origin: DateTime]): DateTime',
    description:
      'Rounds a DateTime to the start of the nearest interval boundary. Supports INTERVAL n SECOND/MINUTE/HOUR/DAY/WEEK/MONTH/QUARTER/YEAR. The origin parameter controls where intervals are anchored.',
    longDescription:
      'toStartOfInterval is the most flexible date-bucketing function in ClickHouse. It handles any granularity that the specialised functions (toStartOfDay, toStartOfWeek…) cannot. Common uses: 5-minute candles for time-series charts, 15-minute activity heatmaps, bi-weekly billing cycles. The optional origin parameter anchors intervals at a specific timestamp rather than the Unix epoch.',
    exampleSql: `-- 5-minute buckets
SELECT
  toStartOfInterval(created_at, INTERVAL 5 MINUTE) AS bucket,
  count() AS events
FROM events
WHERE created_at >= now() - INTERVAL 1 HOUR
GROUP BY bucket
ORDER BY bucket`,
    hypequeryExample: `import { createQueryBuilder, rawAs, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const fiveMin = await db
  .table('events')
  .select([
    selectExpr('toStartOfInterval(created_at, INTERVAL 5 MINUTE)', 'bucket'),
    rawAs('count()', 'events'),
  ])
  .where('created_at', 'gte', new Date(Date.now() - 3600 * 1000))
  .groupBy('bucket')
  .orderBy('bucket', 'ASC')
  .execute();`,
    hypequeryFilename: 'five-minute-buckets.ts',
    returnType: 'DateTime',
    notes: [
      'Intervals smaller than 1 second are not supported.',
      'The origin parameter (third argument) defaults to the Unix epoch (1970-01-01 00:00:00 UTC).',
      'For week intervals, origin controls which day of the week is considered the "start".',
      'More flexible than toStartOfDay/Week/Month but slightly slower on very large datasets.',
    ],
    relatedFunctions: ['toStartOfDay', 'toStartOfMinute', 'toStartOfFiveMinute', 'toStartOfHour'],
    relatedPillars: [
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
      { href: '/clickhouse-real-time-analytics', label: 'Real-Time Analytics' },
      { href: '/clickhouse-dashboard', label: 'ClickHouse Dashboard' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse 5-minute buckets',
        copy: 'toStartOfInterval(ts, INTERVAL 5 MINUTE) groups events into 5-minute windows. Ideal for real-time monitoring dashboards and rate charts.',
      },
      {
        title: 'Custom time interval grouping ClickHouse',
        copy: 'When toStartOfDay and toStartOfHour are too coarse, toStartOfInterval handles any granularity. Pass the interval as a literal INTERVAL n UNIT expression.',
      },
    ],
    faqItems: [
      {
        question: 'What intervals does toStartOfInterval support?',
        answer: 'SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER, and YEAR. Sub-second intervals are not supported.',
      },
      {
        question: 'How do I anchor a weekly interval to Saturday instead of Monday?',
        answer: 'Set origin to any Saturday date: toStartOfInterval(ts, INTERVAL 1 WEEK, toDateTime(\'2024-01-06\')).',
      },
    ],
  },

  {
    slug: 'now',
    name: 'now',
    cluster: 'date',
    tagline: 'Return the current server DateTime — the anchor for relative time filters.',
    metaTitle: 'ClickHouse now() function — current DateTime in TypeScript queries | hypequery',
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
    tagline: 'Convert a string or DateTime to a ClickHouse Date value.',
    metaTitle: 'ClickHouse toDate — convert strings to Date in TypeScript | hypequery',
    metaDescription:
      'toDate converts strings (\'YYYY-MM-DD\') and DateTimes to ClickHouse Date values. Learn how to use it in TypeScript with hypequery for date comparisons and filtering.',
    signature: 'toDate(value: String | DateTime | Int): Date',
    description:
      'Converts a string in YYYY-MM-DD format, a DateTime value, or a Unix timestamp integer to a ClickHouse Date. Used for date literals in WHERE clauses and INSERT statements.',
    longDescription:
      'toDate is the standard way to write date literals in ClickHouse SQL. When filtering by date ranges without a time component, toDate is cleaner than full DateTime literals. It also strips the time portion from a DateTime, which is useful when comparing a DateTime column against a Date value.',
    exampleSql: `-- Filter by date range using toDate literals
SELECT count() FROM events
WHERE toDate(created_at) BETWEEN toDate('2024-01-01') AND toDate('2024-03-31')

-- Strip time from DateTime
SELECT user_id, toDate(created_at) AS signup_date FROM users`,
    hypequeryExample: `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const q1events = await db
  .table('events')
  .select(['id', 'user_id', 'created_at'])
  .where((expr) => expr.raw("toDate(created_at) BETWEEN toDate('2024-01-01') AND toDate('2024-03-31')"))
  .execute();`,
    hypequeryFilename: 'q1-events.ts',
    returnType: 'Date',
    notes: [
      'Accepted string format is YYYY-MM-DD only. Other formats require parseDateTimeBestEffort.',
      'toDate(0) returns 1970-01-01 — useful for NULL-safe comparisons.',
      'For DateTime64 columns, use toDate32 to preserve dates before 1970.',
    ],
    relatedFunctions: ['toDateTime', 'toDate32', 'parseDateTimeBestEffort', 'toStartOfDay'],
    relatedPillars: [
      { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      { href: '/clickhouse-time-series', label: 'ClickHouse Time Series' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse date literal in WHERE clause',
        copy: 'Use toDate(\'2024-01-01\') to write date literals in ClickHouse SQL. Avoid string comparison — ClickHouse won\'t use the index correctly.',
      },
    ],
    faqItems: [
      {
        question: 'What string format does toDate accept?',
        answer: '\'YYYY-MM-DD\' only. For other formats use parseDateTimeBestEffort or formatDateTimeInJodaSyntax.',
      },
    ],
  },

  {
    slug: 'formatDateTime',
    name: 'formatDateTime',
    cluster: 'date',
    tagline: 'Format a DateTime as a string using strftime-style patterns.',
    metaTitle: 'ClickHouse formatDateTime — format dates as strings in TypeScript | hypequery',
    metaDescription:
      'formatDateTime converts a ClickHouse DateTime to a formatted string using strftime patterns. Use it in TypeScript with hypequery for display-ready date labels.',
    signature: 'formatDateTime(datetime: DateTime, format: String, [timezone: String]): String',
    description:
      'Formats a DateTime value as a string using a format string with strftime-compatible directives. Used to produce human-readable date labels for charts and reports.',
    longDescription:
      'formatDateTime is the primary way to produce date strings for display. It supports all standard strftime directives: %Y (4-digit year), %m (month), %d (day), %H (hour), %M (minute), %S (second), %u (day of week 1-7), %W (week of year), and more. The time zone argument overrides the column\'s stored time zone for display purposes.',
    exampleSql: `SELECT
  formatDateTime(created_at, '%Y-%m') AS month_label,
  count() AS events
FROM events
GROUP BY month_label
ORDER BY month_label`,
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
    rawAs("formatDateTime(created_at, '%Y-%m')", 'month_label'),
    rawAs('count()', 'events'),
  ])
  .groupBy('month_label')
  .orderBy('month_label', 'ASC')
  .execute();`,
    hypequeryFilename: 'monthly-labels.ts',
    returnType: 'String',
    notes: [
      'For sorting, always sort on the underlying DateTime or toStartOfMonth — string sort of formatted dates can break for non-ISO formats.',
      'Use %F as a shorthand for %Y-%m-%d.',
      'The timezone argument is for display only — it does not change the stored value.',
    ],
    relatedFunctions: ['toDate', 'toStartOfMonth', 'toStartOfDay', 'parseDateTime'],
    relatedPillars: [
      { href: '/clickhouse-dashboard', label: 'ClickHouse Dashboard' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse format date as string',
        copy: 'formatDateTime(ts, \'%Y-%m-%d\') produces ISO date strings. Use \'%b %Y\' for labels like "Mar 2024" in charts.',
      },
    ],
    faqItems: [
      {
        question: 'What format directives does formatDateTime support?',
        answer: 'All standard strftime directives: %Y, %m, %d, %H, %M, %S, %u (weekday 1=Mon), %W (week), %j (day of year), %F (%Y-%m-%d shorthand), and more.',
      },
    ],
  },

  // ── AGGREGATE CLUSTER ───────────────────────────────────────────────────────
  {
    slug: 'count',
    name: 'count',
    cluster: 'aggregate',
    tagline: 'Count rows or non-NULL values — ClickHouse\'s fastest aggregate.',
    metaTitle: 'ClickHouse count() — row counting in TypeScript with hypequery',
    metaDescription:
      'ClickHouse count() counts rows or non-NULL values. Learn how to use count(), count(x), and countIf() in TypeScript with hypequery for event tracking and analytics.',
    signature: 'count() | count(column) | countIf(condition)',
    description:
      'Counts the number of rows (count()), non-NULL values in a column (count(col)), or rows matching a condition (countIf). The most common aggregate in analytics queries.',
    longDescription:
      'ClickHouse count() is highly optimised — for count() without a column argument it uses stored row counts and avoids data reading entirely. count(DISTINCT col) is available but use uniq() instead for approximate counts on large datasets as it is orders of magnitude faster. countIf(condition) avoids a subquery when you need conditional counts in a single pass.',
    exampleSql: `-- Total events
SELECT count() FROM events

-- Non-null events with user_id
SELECT count(user_id) FROM events

-- Conditional count without subquery
SELECT
  countIf(status = 'paid') AS paid_count,
  countIf(status = 'failed') AS failed_count
FROM orders`,
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
    metaTitle: 'ClickHouse uniq() — approximate distinct counts in TypeScript | hypequery',
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
    tagline: 'Sum numeric values — revenue totals, event counts, and metric roll-ups.',
    metaTitle: 'ClickHouse sum() — sum aggregation in TypeScript with hypequery',
    metaDescription:
      'ClickHouse sum() sums a numeric column. Learn how to use sum(), sumIf(), and sumArray() in TypeScript with hypequery for revenue, metrics, and financial aggregations.',
    signature: 'sum(column): Number | sumIf(column, condition): Number',
    description:
      'Returns the sum of all non-NULL values in a numeric column. sumIf(col, cond) sums only rows matching a condition — equivalent to SUM(CASE WHEN cond THEN col END) but faster.',
    longDescription:
      'sum() is the core revenue and metric aggregation function in ClickHouse. Combined with GROUP BY date buckets it produces time-series revenue charts. sumIf() performs conditional sums in a single pass — useful for multi-dimension pivot queries. For aggregating arrays of numbers, use arraySum() instead.',
    exampleSql: `-- Daily revenue
SELECT
  toStartOfDay(created_at) AS day,
  sum(amount) AS revenue,
  sumIf(amount, status = 'refunded') AS refunds
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

const dailyRevenue = await db
  .table('orders')
  .select([selectExpr('toStartOfDay(created_at)', 'day')])
  .sum('amount', 'revenue')
  .groupBy('day')
  .orderBy('day', 'DESC')
  .limit(30)
  .execute();`,
    hypequeryFilename: 'daily-revenue.ts',
    returnType: 'Same numeric type as input (Int64/Float64/Decimal)',
    notes: [
      'Overflow handling: UInt64 sums overflow silently. Cast to Int128 or Decimal for large monetary sums.',
      'sumIf(col, cond) runs in one pass — never use SUM(CASE WHEN …) in ClickHouse.',
      'For Decimal columns, sum() preserves precision without floating-point errors.',
    ],
    relatedFunctions: ['avg', 'max', 'min', 'quantile', 'sumIf'],
    relatedPillars: [
      { href: '/clickhouse-saas-analytics', label: 'SaaS Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse revenue aggregation TypeScript',
        copy: 'sum(amount) with GROUP BY toStartOfDay gives daily revenue. In hypequery, combine with .groupBy() and .orderBy() for sorted time series.',
      },
      {
        title: 'sumIf ClickHouse conditional sum',
        copy: 'sumIf(amount, status = \'paid\') vs sumIf(amount, status = \'refunded\') in a single query — one table scan for both totals.',
      },
    ],
    faqItems: [
      {
        question: 'Does ClickHouse sum() handle NULLs?',
        answer: 'Yes — NULL values are ignored in sum(). sum() returns 0 (not NULL) when all values are NULL.',
      },
    ],
  },

  {
    slug: 'avg',
    name: 'avg',
    cluster: 'aggregate',
    tagline: 'Calculate the arithmetic mean — average order value, session duration, latency.',
    metaTitle: 'ClickHouse avg() — average aggregation in TypeScript with hypequery',
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
    tagline: 'Percentile estimates — p50, p95, p99 for latency and performance metrics.',
    metaTitle: 'ClickHouse quantile() — percentile aggregation in TypeScript | hypequery',
    metaDescription:
      'ClickHouse quantile() calculates approximate percentiles (p50, p95, p99). Use it in TypeScript with hypequery for latency analysis and performance SLA monitoring.',
    signature: 'quantile(level)(column): Float64',
    description:
      'Computes an approximate quantile at the specified level (0–1) using a reservoir sampling algorithm. quantile(0.95)(latency) gives the p95 latency. quantiles(0.5, 0.95, 0.99)(col) returns all levels in one pass.',
    longDescription:
      'quantile() uses a t-digest algorithm by default in ClickHouse, providing accurate percentile estimates without storing all values. It is the standard way to monitor SLA compliance (p99 < 200ms), analyse response time distributions, and build performance dashboards. quantiles() (plural) computes multiple percentiles in a single pass — always prefer it over multiple quantile() calls.',
    exampleSql: `-- p50/p95/p99 response times per hour
SELECT
  toStartOfHour(ts) AS hour,
  quantile(0.50)(response_ms) AS p50,
  quantile(0.95)(response_ms) AS p95,
  quantile(0.99)(response_ms) AS p99
FROM api_requests
GROUP BY hour
ORDER BY hour DESC
LIMIT 24`,
    hypequeryExample: `import { createQueryBuilder, rawAs, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const latency = await db
  .table('api_requests')
  .select([
    selectExpr('toStartOfHour(ts)', 'hour'),
    rawAs('quantile(0.50)(response_ms)', 'p50'),
    rawAs('quantile(0.95)(response_ms)', 'p95'),
    rawAs('quantile(0.99)(response_ms)', 'p99'),
  ])
  .groupBy('hour')
  .orderBy('hour', 'DESC')
  .limit(24)
  .execute();`,
    hypequeryFilename: 'latency-percentiles.ts',
    returnType: 'Float64',
    notes: [
      'quantiles(0.5, 0.95, 0.99)(col) returns an Array — one pass for all percentiles.',
      'For exact quantiles use quantileExact() — accurate but uses O(n) memory.',
      'quantileTDigest() is the default algorithm. quantileDDSketch() is more accurate at extreme tails.',
    ],
    relatedFunctions: ['avg', 'quantileExact', 'quantiles', 'median'],
    relatedPillars: [
      { href: '/clickhouse-real-time-analytics', label: 'Real-Time Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse p99 latency query',
        copy: 'quantile(0.99)(response_ms) in a GROUP BY hour query gives hourly p99 latency. Use quantiles(0.5,0.95,0.99) to get all three in one pass.',
      },
      {
        title: 'ClickHouse percentile TypeScript',
        copy: 'Pass quantile expressions as raw SQL in hypequery\'s .select() or .groupBy() to get typed results back in your TypeScript application.',
      },
    ],
    faqItems: [
      {
        question: 'How accurate is quantile() in ClickHouse?',
        answer: 'quantile() uses t-digest and is typically accurate to within 1% of the true percentile. For exact values, use quantileExact() at the cost of higher memory usage.',
      },
      {
        question: 'What is the difference between quantile() and quantiles()?',
        answer: 'quantile(level)(col) returns a single Float64. quantiles(l1, l2, ...)(col) returns an Array of all requested levels in one scan — always use quantiles() when you need more than one percentile.',
      },
    ],
  },

  {
    slug: 'groupArray',
    name: 'groupArray',
    cluster: 'aggregate',
    tagline: 'Collect values into an array — session stitching, event sequences, and path analysis.',
    metaTitle: 'ClickHouse groupArray() — collect rows into arrays | hypequery TypeScript',
    metaDescription:
      'groupArray() aggregates column values into an array per group. Use it in TypeScript with hypequery for session stitching, event sequence analysis, and array analytics.',
    signature: 'groupArray([max_size])(column): Array',
    description:
      'Collects all values of a column within a group into an Array. groupArray(10)(col) limits the array to 10 elements. Essential for building event sequences, path arrays, and collecting ordered lists.',
    longDescription:
      'groupArray() is ClickHouse\'s primary way to materialise multiple rows into a single array value per group. Combined with arrayJoin, groupArrayMovingAvg, and array functions, it enables event sequence analysis, funnel reconstruction, and session stitching entirely in SQL. The optional max_size argument caps memory usage when collecting from large groups.',
    exampleSql: `-- Collect page paths per session
SELECT
  session_id,
  groupArray(page_path) AS path_sequence
FROM page_views
GROUP BY session_id

-- Top 5 events per user
SELECT
  user_id,
  groupArray(5)(event_name) AS recent_events
FROM events
GROUP BY user_id`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const sessions = await db
  .table('page_views')
  .select([
    'session_id',
    rawAs('groupArray(page_path)', 'path_sequence'),
  ])
  .groupBy('session_id')
  .execute();`,
    hypequeryFilename: 'session-paths.ts',
    returnType: 'Array(T)',
    notes: [
      'Ordering within the array is not guaranteed — use arraySort(groupArray(col)) if order matters.',
      'groupArraySorted(n)(col, order_col) collects the top-n values by a sort key in one pass.',
      'For large groups, always cap with groupArray(max_size) to avoid OOM errors.',
    ],
    relatedFunctions: ['arrayJoin', 'arraySort', 'groupArrayMovingAvg', 'arrayReduce'],
    relatedPillars: [
      { href: '/clickhouse-product-analytics', label: 'Product Analytics' },
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse collect rows into array',
        copy: 'groupArray(column) is the GROUP_CONCAT equivalent in ClickHouse — it produces an Array per group. Filter and sort the array with array functions afterward.',
      },
      {
        title: 'ClickHouse session path analysis',
        copy: 'GROUP BY session_id, then groupArray(page_path) WITHIN GROUP ordered by ts gives per-session page sequences for path and funnel analysis.',
      },
    ],
    faqItems: [
      {
        question: 'Is the order of elements in groupArray guaranteed?',
        answer: 'No. Use arraySort(groupArray(col)) or groupArraySorted() if order matters.',
      },
    ],
  },

  // ── STRING CLUSTER ──────────────────────────────────────────────────────────
  {
    slug: 'toString',
    name: 'toString',
    cluster: 'string',
    tagline: 'Cast any ClickHouse value to a String — the universal type conversion function.',
    metaTitle: 'ClickHouse toString() — type casting to String in TypeScript | hypequery',
    metaDescription:
      'toString() converts any ClickHouse value (numbers, dates, UUIDs) to a String. Use it in TypeScript with hypequery for display fields, joins, and schema normalisation.',
    signature: 'toString(value: Any): String',
    description:
      'Converts any ClickHouse value to its string representation. Equivalent to CAST(col AS String). Handles all numeric types, dates, UUIDs, and IP addresses.',
    longDescription:
      'toString() is the universal type-cast in ClickHouse SQL. It is most commonly used when joining across tables that store IDs as different types (UInt64 vs String), when selecting for display (formatDateTime gives nicer date strings), or when inserting into a String column from a numeric source. For structured JSON output use JSONExtractString or toJSONString.',
    exampleSql: `-- Join on mismatched ID types
SELECT e.event_name, u.email
FROM events e
JOIN users u ON toString(e.user_id) = u.external_id

-- Display UInt64 as string
SELECT toString(order_id) AS order_ref FROM orders`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const orders = await db
  .table('orders')
  .select([
    rawAs('toString(order_id)', 'order_ref'),
    'user_id',
    'created_at',
  ])
  .execute();`,
    hypequeryFilename: 'order-display.ts',
    returnType: 'String',
    notes: [
      'For dates, toString returns ISO format. Use formatDateTime for custom display strings.',
      'toStringCutToZero() is like toString but stops at the first null byte — useful for FixedString columns.',
      'CAST(col AS String) and toString(col) are equivalent.',
    ],
    relatedFunctions: ['toUInt64', 'toInt64', 'toFloat64', 'formatDateTime', 'concat'],
    relatedPillars: [
      { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      { href: '/clickhouse-schema', label: 'ClickHouse Schema' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse cast to string TypeScript',
        copy: 'Use toString(col) to convert numbers, dates, or UUIDs to strings in ClickHouse SQL. hypequery maps ClickHouse types to TypeScript types via the generated schema.',
      },
    ],
    faqItems: [
      {
        question: 'What is the difference between toString() and CAST(x AS String)?',
        answer: 'They are equivalent — toString(x) is syntactic sugar for CAST(x AS String).',
      },
    ],
  },

  {
    slug: 'concat',
    name: 'concat',
    cluster: 'string',
    tagline: 'Concatenate strings — build labels, composite keys, and display values.',
    metaTitle: 'ClickHouse concat() — string concatenation in TypeScript with hypequery',
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
    metaTitle: 'ClickHouse if() — inline conditional in TypeScript queries | hypequery',
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
    tagline: 'Multi-branch conditional — clean CASE WHEN replacement for status mapping.',
    metaTitle: 'ClickHouse multiIf() — multi-branch conditional in TypeScript | hypequery',
    metaDescription:
      'ClickHouse multiIf() evaluates multiple conditions in order and returns the first matching value. Use it in TypeScript with hypequery for status maps and category logic.',
    signature: 'multiIf(cond1, val1, cond2, val2, ..., else): T',
    description:
      'Evaluates conditions left to right and returns the value of the first true condition. The final argument is the default (else) value. The ClickHouse replacement for CASE WHEN…THEN…ELSE.',
    longDescription:
      'multiIf() is ClickHouse\'s multi-branch conditional. It evaluates each condition in order and returns the associated value for the first true condition. Unlike if(), it is short-circuit — later branches are not evaluated if an earlier one matches. This makes it safe to use with potentially NULL-returning expressions in later branches.',
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
GROUP BY grade`,
    hypequeryExample: `import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const graded = await db
  .table('exam_results')
  .select([
    rawAs("multiIf(score >= 90, 'A', score >= 80, 'B', score >= 70, 'C', score >= 60, 'D', 'F')", 'grade'),
  ])
  .count('student_id', 'students')
  .groupBy('grade')
  .execute();`,
    hypequeryFilename: 'grade-classification.ts',
    returnType: 'Same type as value branches',
    notes: [
      'Short-circuit: once a condition is true, later conditions are not evaluated.',
      'All value branches must return the same (or compatible) type.',
      'For simple two-branch conditionals, if() is more readable.',
    ],
    relatedFunctions: ['if', 'ifNull', 'coalesce', 'nullIf'],
    relatedPillars: [
      { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
    ],
    searchIntentCards: [
      {
        title: 'ClickHouse CASE WHEN TypeScript',
        copy: 'multiIf(cond1, val1, cond2, val2, ..., default) is the ClickHouse equivalent of CASE WHEN. It is more concise and short-circuits on the first match.',
      },
    ],
    faqItems: [
      {
        question: 'Does multiIf() short-circuit evaluate?',
        answer: 'Yes — once a condition is true, later conditions and their values are not evaluated. This makes it safer than nested if() for NULL-sensitive expressions.',
      },
    ],
  },

  // ── MATH CLUSTER ────────────────────────────────────────────────────────────
  {
    slug: 'round',
    name: 'round',
    cluster: 'math',
    tagline: 'Round a number to N decimal places — clean display values and bucketing.',
    metaTitle: 'ClickHouse round() — numeric rounding in TypeScript with hypequery',
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
    metaTitle: 'ClickHouse intDiv() — integer division for bucketing in TypeScript | hypequery',
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
];

export const functionsBySlug = Object.fromEntries(
  clickhouseFunctions.map((fn) => [fn.slug, fn]),
) as Record<string, ClickHouseFunctionDef>;

export const functionsByCluster = clickhouseFunctions.reduce<
  Record<ClickHouseFunctionCluster, ClickHouseFunctionDef[]>
>(
  (acc, fn) => {
    acc[fn.cluster].push(fn);
    return acc;
  },
  { date: [], aggregate: [], string: [], conditional: [], math: [] },
);
