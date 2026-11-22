/**
 * RFC 0026 rank, share, limitBy and other against ClickHouse, each checked
 * against brute-force SQL over the same draft rows
 * (specs/security-protocol/drafts/query-calculations-v1/rows.json): plain
 * GROUP BY and uniqExact queries written by hand, with ranking, shares and
 * bucketing derived from their results rather than from the planner's SQL.
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { createDatasetClient } from '../../executor.js';
import type { DatasetQuery } from '../../types.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../../specs/security-protocol/drafts/query-calculations-v1/rows.json', import.meta.url,
), 'utf8')) as { rows: Record<string, unknown>[]; range: [string, string] };

const table = 'hq_rfc0026_rank_share';
const db = createQueryBuilder({
  host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database,
});
const client = createDatasetClient({ queryBuilder: db });
const context = { runtime: { tenant: { id: 'a' } } };
const Orders = dataset('calcRankShare', {
  source: table, timeKey: 'created_at', tenantKey: 'tenant',
  dimensions: {
    created_at: dimension.timestamp(), country: dimension.string(), channel: dimension.string(),
    user_id: dimension.string(), id: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'), orders: measure.count('id'), users: measure.countDistinct('user_id'),
    avg_order: measure.avg('amount'),
  },
});
const range = [
  { field: 'created_at', operator: 'gte' as const, value: fixture.range[0] },
  { field: 'created_at', operator: 'lt' as const, value: fixture.range[1] },
];
const WHERE = `tenant = 'a' AND created_at >= '2026-01-01 00:00:00' AND created_at < '2026-05-01 00:00:00'`;

/** Rows from a hand-written statement. */
async function brute(sql: string): Promise<Record<string, unknown>[]> {
  const url = new URL('/', TEST_CONNECTION_CONFIG.host);
  url.searchParams.set('user', TEST_CONNECTION_CONFIG.user);
  url.searchParams.set('password', TEST_CONNECTION_CONFIG.password);
  url.searchParams.set('database', TEST_CONNECTION_CONFIG.database);
  const response = await fetch(url, { method: 'POST', body: `${sql} FORMAT JSONEachRow` });
  if (!response.ok) throw new Error(await response.text());
  return (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
}

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const month = (value: unknown) => String(value).slice(0, 7);
const key = (row: Record<string, unknown>) => `${month(row.period ?? '')}|${row.country ?? '∅'}`;
const execute = (query: DatasetQuery) => client.execute(Orders, query, context);

/** SQL `rank()` over `rows`: 1 + the number of rows in the partition with a strictly greater value. */
function rankOf<T>(rows: T[], partition: (row: T) => string, value: (row: T) => number | null, direction: 'asc' | 'desc'): Map<T, number> {
  const ranks = new Map<T, number>();
  for (const row of rows) {
    const own = value(row);
    const better = rows.filter(other => partition(other) === partition(row)).filter(other => {
      const theirs = value(other);
      if (own === null) return theirs !== null;
      if (theirs === null) return false;
      return direction === 'desc' ? theirs > own : theirs < own;
    }).length;
    ranks.set(row, better + 1);
  }
  return ranks;
}

describe('RFC 0026 rank, share, limitBy and other against brute-force SQL', () => {
  beforeAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${table}`);
    await runSql(`CREATE TABLE ${table} (tenant String, id UInt32, created_at DateTime64(3, 'UTC'), country Nullable(String), `
      + 'channel String, user_id String, amount Float64) ENGINE = MergeTree ORDER BY (tenant, id)');
    await insertRows(table, fixture.rows);
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${table}`); });

  const monthlyByCountry = () => brute(`SELECT toString(toStartOfMonth(created_at)) AS period, country, sum(amount) AS revenue, `
    + `uniqExact(user_id) AS users FROM ${table} WHERE ${WHERE} GROUP BY period, country`);

  it('rank: within period, ties share a rank, NULL country ranked like any group', async () => {
    const result = await execute({
      by: 'month', dimensions: ['country'], measures: ['revenue'], filters: range,
      calculations: [
        { name: 'revenue_rank', rank: { measure: 'revenue', within: ['period'] } },
        { name: 'revenue_rank_asc', rank: { measure: 'revenue', within: ['period'], direction: 'asc' } },
      ],
    });
    const expected = await monthlyByCountry();
    const desc = rankOf(expected, row => month(row.period), row => num(row.revenue), 'desc');
    const asc = rankOf(expected, row => month(row.period), row => num(row.revenue), 'asc');
    const want = new Map(expected.map(row => [key(row), [desc.get(row), asc.get(row)]]));
    expect(result.data).toHaveLength(expected.length);
    for (const row of result.data) expect([num(row.revenue_rank), num(row.revenue_rank_asc)]).toEqual(want.get(key(row)));
    // March: FR and GB both 45, so they share a rank.
    const march = result.data.filter(row => month(row.period) === '2026-03');
    expect(march.filter(row => ['FR', 'GB'].includes(String(row.country))).map(row => row.revenue_rank)).toEqual(
      expect.arrayContaining([march.find(row => row.country === 'FR')!.revenue_rank]),
    );
    expect(march.find(row => row.country === 'FR')!.revenue_rank).toBe(march.find(row => row.country === 'GB')!.revenue_rank);
    expect(result.meta.calculations?.[0]).toEqual({ name: 'revenue_rank', kind: 'rank', calculation: 'revenue_rank', measure: 'revenue', type: 'integer' });
  });

  it('rank: having on a rank keeps the top groups, ranked before having filters', async () => {
    const result = await execute({
      dimensions: ['country'], measures: ['revenue'], filters: range,
      calculations: [{ name: 'r', rank: { measure: 'revenue' } }],
      having: [{ measure: 'r', operator: 'lte', value: 2 }],
      orderBy: [{ field: 'r', direction: 'asc' }],
    });
    const expected = await brute(`SELECT country, sum(amount) AS revenue FROM ${table} WHERE ${WHERE} GROUP BY country ORDER BY revenue DESC LIMIT 2`);
    expect(result.data.map(row => [row.country, num(row.revenue), num(row.r)]))
      .toEqual(expected.map((row, index) => [row.country, num(row.revenue), index + 1]));
  });

  it('share (additive): revenue by country as a share of each month', async () => {
    const result = await execute({
      by: 'month', dimensions: ['country'], measures: ['revenue'], filters: range,
      calculations: [{ name: 'revenue_share', share: { measure: 'revenue', of: ['period'] } }],
    });
    const groups = await monthlyByCountry();
    const totals = await brute(`SELECT toString(toStartOfMonth(created_at)) AS period, sum(amount) AS revenue FROM ${table} WHERE ${WHERE} GROUP BY period`);
    const total = new Map(totals.map(row => [month(row.period), num(row.revenue)!]));
    const want = new Map(groups.map(row => [key(row), num(row.revenue)! / total.get(month(row.period))!]));
    for (const row of result.data) expect(num(row.revenue_share)).toBeCloseTo(want.get(key(row))!, 12);
    const sums = new Map<string, number>();
    for (const row of result.data) sums.set(month(row.period), (sums.get(month(row.period)) ?? 0) + num(row.revenue_share)!);
    for (const value of sums.values()) expect(value).toBeCloseTo(1, 12);
  });

  it('share (countDistinct): users by country of the grand total, re-aggregated, so shares sum past 1', async () => {
    const result = await execute({
      dimensions: ['country'], measures: ['users'], filters: range,
      calculations: [{ name: 'user_share', share: { measure: 'users' } }],
    });
    const groups = await brute(`SELECT country, uniqExact(user_id) AS users FROM ${table} WHERE ${WHERE} GROUP BY country`);
    const [{ users: total }] = await brute(`SELECT uniqExact(user_id) AS users FROM ${table} WHERE ${WHERE}`);
    const want = new Map(groups.map(row => [String(row.country ?? '∅'), num(row.users)! / num(total)!]));
    for (const row of result.data) expect(num(row.user_share)).toBeCloseTo(want.get(String(row.country ?? '∅'))!, 12);
    // u1 orders in US, DE and FR: the shares overlap, as exact distinct counts do.
    expect(result.data.reduce((sum, row) => sum + num(row.user_share)!, 0)).toBeGreaterThan(1);
  });

  it('share (countDistinct): of period, with NULL countries joined to their own month', async () => {
    const result = await execute({
      by: 'month', dimensions: ['country'], measures: ['users'], filters: range,
      calculations: [{ name: 'user_share', share: { measure: 'users', of: ['period'] } }],
    });
    const groups = await monthlyByCountry();
    const totals = await brute(`SELECT toString(toStartOfMonth(created_at)) AS period, uniqExact(user_id) AS users FROM ${table} WHERE ${WHERE} GROUP BY period`);
    const total = new Map(totals.map(row => [month(row.period), num(row.users)!]));
    const want = new Map(groups.map(row => [key(row), num(row.users)! / total.get(month(row.period))!]));
    expect(result.data).toHaveLength(groups.length);
    for (const row of result.data) expect(num(row.user_share)).toBeCloseTo(want.get(key(row))!, 12);
  });

  it('share (avg) of a grouping dimension, NULL keys matching NULL keys', async () => {
    const result = await execute({
      dimensions: ['country', 'channel'], measures: ['avg_order'], filters: range,
      calculations: [{ name: 's', share: { measure: 'avg_order', of: ['country'] } }],
    });
    const groups = await brute(`SELECT country, channel, avg(amount) AS a FROM ${table} WHERE ${WHERE} GROUP BY country, channel`);
    const totals = await brute(`SELECT country, avg(amount) AS a FROM ${table} WHERE ${WHERE} GROUP BY country`);
    const total = new Map(totals.map(row => [String(row.country ?? '∅'), num(row.a)!]));
    const want = new Map(groups.map(row => [`${row.country ?? '∅'}|${row.channel}`, num(row.a)! / total.get(String(row.country ?? '∅'))!]));
    expect(result.data.some(row => row.country === null)).toBe(true);
    for (const row of result.data) expect(num(row.s)).toBeCloseTo(want.get(`${row.country ?? '∅'}|${row.channel}`)!, 12);
  });

  it('limitBy: the top 2 countries of every month', async () => {
    const result = await execute({
      by: 'month', dimensions: ['country'], measures: ['revenue'], filters: range,
      orderBy: [{ field: 'period', direction: 'asc' }, { field: 'revenue', direction: 'desc' }, { field: 'country', direction: 'asc' }],
      limitBy: { n: 2, by: ['period'] },
    });
    const expected = await brute(`SELECT period, country, revenue FROM (SELECT toString(toStartOfMonth(created_at)) AS period, country, `
      + `sum(amount) AS revenue, row_number() OVER (PARTITION BY period ORDER BY revenue DESC, country ASC) AS n FROM ${table} `
      + `WHERE ${WHERE} GROUP BY period, country) WHERE n <= 2 ORDER BY period, revenue DESC, country`);
    expect(result.data.map(row => [month(row.period), row.country, num(row.revenue)]))
      .toEqual(expected.map(row => [month(row.period), row.country, num(row.revenue)]));
  });

  it('other: top 2 countries by revenue, the rest (and NULL) as Other, countDistinct exact in the bucket', async () => {
    const result = await execute({
      dimensions: ['country'], measures: ['revenue', 'users', 'orders'], filters: range,
      other: { dimension: 'country', n: 2, measure: 'revenue' },
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    });
    const top = (await brute(`SELECT country FROM ${table} WHERE ${WHERE} AND country IS NOT NULL GROUP BY country `
      + 'ORDER BY sum(amount) DESC, country ASC LIMIT 2')).map(row => String(row.country));
    const list = top.map(country => `'${country}'`).join(', ');
    const expected = await brute(`SELECT if(country IN (${list}), country, 'Other') AS bucket, sum(amount) AS revenue, `
      + `uniqExact(user_id) AS users, count(id) AS orders FROM ${table} WHERE ${WHERE} GROUP BY bucket ORDER BY revenue DESC`);
    expect(result.data.map(row => [row.country, num(row.revenue), num(row.users), num(row.orders)]))
      .toEqual(expected.map(row => [row.bucket, num(row.revenue), num(row.users), num(row.orders)]));
    // With only the leader kept, u1 sits in several remainder countries:
    // re-aggregating grouped rows would count them twice, regrouping does not.
    const leaderOnly = await execute({
      dimensions: ['country'], measures: ['users'], filters: range, other: { dimension: 'country', n: 1, measure: 'revenue' },
    });
    const grouped = await brute(`SELECT country, uniqExact(user_id) AS users FROM ${table} WHERE ${WHERE} GROUP BY country`);
    const naive = grouped.filter(row => row.country !== top[0]).reduce((sum, row) => sum + num(row.users)!, 0);
    const [{ users: exact }] = await brute(`SELECT uniqExact(user_id) AS users FROM ${table} WHERE ${WHERE} AND (country IS NULL OR country != '${top[0]}')`);
    const remainder = num(leaderOnly.data.find(row => row.country === 'Other')!.users);
    expect(remainder).toBe(num(exact));
    expect(remainder).toBeLessThan(naive);
  });

  it('other: by month with a label, a share of each month, and filters still reading source values', async () => {
    const result = await execute({
      by: 'month', dimensions: ['country'], measures: ['users'],
      filters: [...range, { field: 'country', operator: 'neq', value: 'ES' }],
      other: { dimension: 'country', n: 1, measure: 'revenue', label: 'Rest' },
      calculations: [{ name: 'user_share', share: { measure: 'users', of: ['period'] } }],
    });
    const where = `${WHERE} AND country != 'ES'`;
    const [{ country: leader }] = await brute(`SELECT country FROM ${table} WHERE ${where} AND country IS NOT NULL GROUP BY country ORDER BY sum(amount) DESC, country LIMIT 1`);
    const expected = await brute(`SELECT toString(toStartOfMonth(created_at)) AS period, if(country = '${String(leader)}', country, 'Rest') AS bucket, `
      + `uniqExact(user_id) AS users FROM ${table} WHERE ${where} GROUP BY period, bucket`);
    const totals = await brute(`SELECT toString(toStartOfMonth(created_at)) AS period, uniqExact(user_id) AS users FROM ${table} WHERE ${where} GROUP BY period`);
    const total = new Map(totals.map(row => [month(row.period), num(row.users)!]));
    const want = new Map(expected.map(row => [`${month(row.period)}|${row.bucket}`, [num(row.users), num(row.users)! / total.get(month(row.period))!]]));
    expect(result.data).toHaveLength(expected.length);
    for (const row of result.data) {
      const [users, share] = want.get(`${month(row.period)}|${row.country}`)!;
      expect(num(row.users)).toBe(users);
      expect(num(row.user_share)).toBeCloseTo(share!, 12);
    }
  });

  it('other with a time compare: the axis preflight and the series both read the top-N list', async () => {
    const result = await execute({
      by: 'month', dimensions: ['country'], measures: ['revenue'], filters: range,
      other: { dimension: 'country', n: 1, measure: 'revenue' },
      calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }],
    });
    const [{ country: leader }] = await brute(`SELECT country FROM ${table} WHERE ${WHERE} AND country IS NOT NULL GROUP BY country ORDER BY sum(amount) DESC, country LIMIT 1`);
    const expected = await brute(`SELECT toString(toStartOfMonth(created_at)) AS period, if(country = '${String(leader)}', country, 'Other') AS bucket, `
      + `sum(amount) AS revenue FROM ${table} WHERE ${WHERE} GROUP BY period, bucket`);
    const revenue = new Map(expected.map(row => [`${month(row.period)}|${row.bucket}`, num(row.revenue)]));
    const seen = result.data.filter(row => revenue.has(key(row)));
    expect(new Set(seen.map(row => row.country))).toEqual(new Set([leader, 'Other']));
    expect(seen).toHaveLength(expected.length);
    for (const row of seen) {
      expect(num(row.revenue)).toBeCloseTo(revenue.get(key(row))!, 9);
      // Within the range, the prior month's value is that month's own row.
      const prior = `2026-${String(Number(month(row.period).slice(5)) - 1).padStart(2, '0')}|${row.country}`;
      if (month(row.period) > month(fixture.range[0]) && revenue.has(prior)) {
        expect(num(row.revenue_previous)).toBeCloseTo(revenue.get(prior)!, 9);
      }
    }
  });

  it('rank and share over time-measure calculations', async () => {
    const result = await execute({
      by: 'month', dimensions: ['country'], measures: ['revenue'], filters: range,
      calculations: [
        { name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } },
        { name: 'growth_rank', rank: { measure: 'revenue_change', within: ['period'] } },
        { name: 'prior_share', share: { measure: 'revenue_previous', of: ['period'] } },
      ],
    });
    const plain = await execute({
      by: 'month', dimensions: ['country'], measures: ['revenue'], filters: range,
      calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }],
    });
    const rows = plain.data;
    const ranks = rankOf(rows, row => month(row.period), row => num(row.revenue_change), 'desc');
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(month(row.period), (totals.get(month(row.period)) ?? 0) + (num(row.revenue_previous) ?? 0));
    const want = new Map(rows.map(row => [key(row), [ranks.get(row), num(row.revenue_previous) === null || totals.get(month(row.period)) === 0
      ? null : num(row.revenue_previous)! / totals.get(month(row.period))!]]));
    for (const row of result.data) {
      const [rank, share] = want.get(key(row))!;
      expect(num(row.growth_rank)).toBe(rank);
      if (share === null) expect(row.prior_share).toBeNull();
      else expect(num(row.prior_share)).toBeCloseTo(share as number, 12);
    }
    await expect(Promise.resolve().then(() => execute({
      by: 'month', dimensions: ['country'], measures: ['revenue'], filters: range,
      calculations: [
        { name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } },
        { name: 's', share: { measure: 'revenue_change_pct' } },
      ],
    }))).rejects.toThrow(/not additive and depends on a shift or window/);
  });
});
