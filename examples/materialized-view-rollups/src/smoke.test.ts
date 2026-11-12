import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './client.js';
import { compare, RANGE } from './query.js';
import { setup } from './setup.js';

/**
 * Ground truth comes from hand-written SQL over the raw `events` table. Both
 * rollups must agree with it exactly: the incremental target stores
 * uniqExact states, and the refreshable target is a full recompute.
 */
interface DayRow { day: string; events: string; unique_users: string; errors: string }

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await db.close();
});

describe('materialized view rollups', () => {
  it('answers the same question from the raw table and the incremental rollup', async () => {
    const result = await compare();
    expect(result.raw.length).toBe(7);
    expect(result.incremental.length).toBe(7);
    for (const [i, rawRow] of result.raw.entries()) {
      const rolled = result.incremental[i];
      expect(String(rolled.period)).toBe(String(rawRow.period));
      expect(Number(rolled.events)).toBe(Number(rawRow.events));
      expect(Number(rolled.uniqueUsers)).toBe(Number(rawRow.uniqueUsers));
      expect(Number(rolled.errorRate)).toBeCloseTo(Number(rawRow.errorRate), 6);
    }
  });

  it('matches hand-written SQL over the raw table', async () => {
    const truth = await db.rawQuery<DayRow>(
      `SELECT toDate(occurred_at) AS day, count() AS events, uniqExact(user_id) AS unique_users,
              countIf(status_code >= 500) AS errors
       FROM events WHERE toDate(occurred_at) BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'
       GROUP BY day ORDER BY day`,
    );
    const rolled = await db.rawQuery<DayRow>(
      `SELECT day, sum(events) AS events, uniqExactMerge(users) AS unique_users, sum(errors) AS errors
       FROM events_daily WHERE day BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'
       GROUP BY day ORDER BY day`,
    );
    expect(rolled).toEqual(truth);
    expect(truth.length).toBe(7);
  });

  it('covers the whole seed, not just the sample range', async () => {
    const [{ total }] = await db.rawQuery<{ total: string }>('SELECT sum(events) AS total FROM events_daily');
    const [{ rows }] = await db.rawQuery<{ rows: string }>('SELECT count() AS rows FROM events');
    expect(Number(total)).toBe(Number(rows));
    expect(Number(rows)).toBe(1_000_000);
  });

  it('refreshable rollup agrees with the raw table per tenant-day and carries the join', async () => {
    const truth = await db.rawQuery<{ tenant_id: number; day: string; events: string; p95: number }>(
      `SELECT tenant_id, toDate(occurred_at) AS day, count() AS events, quantileExact(0.95)(latency_ms) AS p95
       FROM events WHERE toDate(occurred_at) BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'
       GROUP BY tenant_id, day ORDER BY tenant_id, day`,
    );
    const summary = await db.rawQuery<{ tenant_id: number; day: string; events: string; p95: number; plan: string }>(
      `SELECT tenant_id, day, events, p95_latency_ms AS p95, plan
       FROM tenant_daily_summary WHERE day BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'
       ORDER BY tenant_id, day`,
    );
    expect(summary.length).toBe(truth.length);
    for (const [i, t] of truth.entries()) {
      expect(summary[i].tenant_id).toBe(t.tenant_id);
      expect(summary[i].day).toBe(t.day);
      expect(Number(summary[i].events)).toBe(Number(t.events));
      expect(Number(summary[i].p95)).toBe(Math.trunc(Number(t.p95)));
      expect(['free', 'starter', 'growth', 'enterprise']).toContain(summary[i].plan);
    }
  });

  it('exposes the per-plan view through the dataset (the exampleRequest shape)', async () => {
    const result = await compare();
    expect(result.refreshable.length).toBeGreaterThan(0);
    expect(result.refreshable.length).toBeLessThanOrEqual(4);
    for (const row of result.refreshable) {
      expect(row).toHaveProperty('plan');
      expect(Number(row.events)).toBeGreaterThan(0);
      expect(Number(row.worstP95LatencyMs)).toBeGreaterThan(0);
    }
    expect(Object.keys(result.timingsMs).sort()).toEqual(['incremental', 'raw', 'refreshable']);
  });
});
