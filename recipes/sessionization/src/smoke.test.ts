import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './client.js';
import { compareTimeouts, RANGE, run, toSQL, week } from './recipe.js';
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
 * Ground truth without window functions: each user's sorted timestamps, split
 * with arraySplit wherever the gap to the previous event is over 1,800 s.
 * (The ARRAY JOIN alias must not be `sessions`: ClickHouse aliases are global
 * to the query, and the outer `count() AS sessions` would capture it.)
 */
const TRUTH_SQL = `
  SELECT toDate(s[1]) AS day, count() AS sessions, uniqExact(user_id) AS users,
         avg(toUInt32(s[-1]) - toUInt32(s[1])) AS avg_duration, avg(length(s)) AS avg_events
  FROM (
    SELECT user_id,
           arraySort(groupArray(occurred_at)) AS ts,
           arraySplit((t, gap) -> gap > 1800, ts, arrayDifference(arrayMap(t -> toUInt32(t), ts))) AS user_sessions
    FROM events GROUP BY tenant_id, user_id
  )
  ARRAY JOIN user_sessions AS s
  WHERE s[1] BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'
  GROUP BY day ORDER BY day`;

describe('sessionization recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured output: counts exactly, averages to 9 digits', async () => {
    const rows = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8')) as typeof rows;
    expect(rows.length).toBe(7);
    for (const [i, row] of rows.entries()) {
      expect(String(row.period)).toBe(String(captured[i].period));
      expect(Number(row.sessions)).toBe(Number(captured[i].sessions));
      expect(Number(row.users)).toBe(Number(captured[i].users));
      for (const key of ['sessionsPerUser', 'avgDurationSeconds', 'avgEventsPerSession'] as const) {
        expect(Number(row[key])).toBeCloseTo(Number(captured[i][key]), 9);
      }
    }
  });

  it('matches sessions rebuilt with arraySplit, day by day', async () => {
    const truth = await db.rawQuery<{ day: string; sessions: string; users: string; avg_duration: number; avg_events: number }>(TRUTH_SQL);
    const rows = await run();
    expect(rows.length).toBe(truth.length);
    for (const [i, t] of truth.entries()) {
      expect(String(rows[i].period).slice(0, 10)).toBe(t.day);
      expect(Number(rows[i].sessions)).toBe(Number(t.sessions));
      expect(Number(rows[i].users)).toBe(Number(t.users));
      expect(Number(rows[i].avgDurationSeconds)).toBeCloseTo(Number(t.avg_duration), 6);
      expect(Number(rows[i].avgEventsPerSession)).toBeCloseTo(Number(t.avg_events), 6);
    }
  });

  it('pins the week: 26,262 sessions by 1,705 users, 195 s and 1.23 events on average', async () => {
    const w = await week();
    expect(Number(w.sessions)).toBe(26262);
    expect(Number(w.users)).toBe(1705);
    expect(Number(w.avgDurationSeconds)).toBeCloseTo(195.41, 2);
    expect(Number(w.avgEventsPerSession)).toBeCloseTo(1.2312, 4);
  });

  it('pins how the timeout changes the answer', async () => {
    expect(await compareTimeouts()).toEqual([
      { timeoutMinutes: 15, sessions: '29033', avgDurationSeconds: 49.7 },
      { timeoutMinutes: 30, sessions: '26262', avgDurationSeconds: 195.4 },
      { timeoutMinutes: 60, sessions: '22122', avgDurationSeconds: 727.6 },
    ]);
  });

  it('covers every event exactly once', async () => {
    const [row] = await db.rawQuery<{ events: string; total: string }>(
      'SELECT (SELECT sum(event_count) FROM sessionization_sessions) AS events, (SELECT count() FROM events) AS total',
    );
    expect(Number(row.events)).toBe(Number(row.total));
  });
});
