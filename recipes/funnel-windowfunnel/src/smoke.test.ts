import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './client.js';
import { compareModes, MONTH, overall, run, toSQL } from './recipe.js';
import { setup, teardown } from './setup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await teardown();
  await db.close();
});

/**
 * Ground truth without windowFunnel: per user, the event times of each step as
 * sorted arrays, then "is there a login t0, a later query_run t1 and a later
 * export t2, all within 86,400 s of t0?" checked with arrayExists.
 */
const TRUTH_SQL = `
  WITH per_user AS (
    SELECT tenant_id, user_id,
           groupArrayIf(toUInt32(occurred_at), event_type = 'login') AS l,
           groupArrayIf(toUInt32(occurred_at), event_type = 'query_run') AS q,
           groupArrayIf(toUInt32(occurred_at), event_type = 'export') AS e
    FROM events WHERE occurred_at BETWEEN '${MONTH[0]}' AND '${MONTH[1]}'
    GROUP BY tenant_id, user_id)
  SELECT tenant_id,
         countIf(length(l) > 0) AS s1,
         countIf(arrayExists(t0 -> arrayExists(t1 -> t1 > t0 AND t1 <= t0 + 86400, q), l)) AS s2,
         countIf(arrayExists(t0 -> arrayExists(t1 -> t1 > t0 AND t1 <= t0 + 86400
           AND arrayExists(t2 -> t2 > t1 AND t2 <= t0 + 86400, e), q), l)) AS s3
  FROM per_user GROUP BY tenant_id`;

describe('windowFunnel funnel recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured output exactly (distinct counts are exact)', async () => {
    const rows = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(rows).toEqual(captured);
    expect(rows.length).toBe(10);
  });

  it('matches a funnel computed by hand with arrays, per tenant and overall', async () => {
    const truth = await db.rawQuery<{ tenant_id: number; s1: string; s2: string; s3: string }>(TRUTH_SQL);
    const byTenant = new Map(truth.map((t) => [Number(t.tenant_id), t]));
    for (const row of await run()) {
      const t = byTenant.get(Number(row.tenantId))!;
      expect([row.loggedIn, row.ranQuery, row.exported].map(Number)).toEqual([t.s1, t.s2, t.s3].map(Number));
      expect(Number(row.conversion)).toBeCloseTo(Number(t.s3) / Number(t.s1), 9);
    }
    const all = await overall();
    const sum = (k: 's1' | 's2' | 's3') => truth.reduce((n, t) => n + Number(t[k]), 0);
    expect([all.loggedIn, all.ranQuery, all.exported].map(Number)).toEqual([sum('s1'), sum('s2'), sum('s3')]);
    expect([all.loggedIn, all.ranQuery, all.exported].map(Number)).toEqual([1537, 863, 337]);
  });

  it('pins how the strict modes change the October funnel', async () => {
    const rows = await compareModes();
    const table = Object.fromEntries(rows.map((r) => [`${r.mode} / ${r.input}`, [r.loggedIn, r.ranQuery, r.exported].map(Number)]));
    expect(table).toEqual({
      'default / all events': [1537, 863, 337],
      'strict_order / all events': [1537, 178, 6],
      'strict_deduplication / all events': [1537, 641, 138],
      'strict_increase / all events': [1537, 863, 337],
      'strict_once / all events': [1537, 863, 337],
      'default / funnel events only': [1537, 863, 337],
      'strict_order / funnel events only': [1537, 635, 244],
      'strict_deduplication / funnel events only': [1537, 641, 138],
      'strict_increase / funnel events only': [1537, 863, 337],
      'strict_once / funnel events only': [1537, 863, 337],
    });
  });

  it('documents a ClickHouse 25.8 quirk: strict_deduplication can report a step the window never reached', async () => {
    // login, query_run 5 minutes later, export a day later (outside the 1 h
    // window), then a second query_run. Only steps 1 and 2 happen inside the
    // window, and the default mode says 2; strict_deduplication says 3.
    const [row] = await db.rawQuery<{ dflt: number; dedup: number }>(
      `SELECT windowFunnel(3600)(t, e = 'login', e = 'query_run', e = 'export') AS dflt,
              windowFunnel(3600, 'strict_deduplication')(t, e = 'login', e = 'query_run', e = 'export') AS dedup
       FROM values('t DateTime, e String',
         ('2026-01-01 00:00:00', 'login'), ('2026-01-01 00:05:00', 'query_run'),
         ('2026-01-02 00:00:00', 'export'), ('2026-01-03 00:00:00', 'query_run'))`,
    );
    expect(Number(row.dflt)).toBe(2);
    expect(Number(row.dedup)).toBe(3);
  });
});
