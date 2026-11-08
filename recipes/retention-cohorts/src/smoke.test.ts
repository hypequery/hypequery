import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './client.js';
import { COHORTS, MAX_WEEKS, run, toGrid, toSQL } from './recipe.js';
import { setup } from './setup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await db.close();
});

describe('retention cohorts recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured output exactly (distinct counts are exact)', async () => {
    const rows = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(rows).toEqual(captured);
    expect(rows.length).toBe(5 * (MAX_WEEKS + 1));
  });

  it('matches hand-written SQL over users and events', async () => {
    const truth = await db.rawQuery<{ cohort_week: string; weeks: number; active: string; size: string }>(
      `WITH cohorts AS (
         SELECT user_id, toStartOfWeek(signed_up_at, 1) AS cohort_week,
                count() OVER (PARTITION BY toStartOfWeek(signed_up_at, 1)) AS cohort_size
         FROM users)
       SELECT c.cohort_week, dateDiff('week', c.cohort_week, toStartOfWeek(e.occurred_at, 1)) AS weeks,
              uniqExact(c.user_id) AS active, max(c.cohort_size) AS size
       FROM cohorts AS c INNER JOIN events AS e ON e.user_id = c.user_id
       WHERE e.occurred_at >= c.cohort_week
         AND c.cohort_week BETWEEN '${COHORTS[0]}' AND '${COHORTS[1]}'
       GROUP BY c.cohort_week, weeks HAVING weeks <= ${MAX_WEEKS}
       ORDER BY c.cohort_week, weeks`,
    );
    const rows = await run();
    expect(rows.length).toBe(truth.length);
    for (const [i, t] of truth.entries()) {
      expect(String(rows[i].cohortWeek).slice(0, 10)).toBe(t.cohort_week);
      expect(Number(rows[i].weeksSinceSignup)).toBe(Number(t.weeks));
      expect(Number(rows[i].activeUsers)).toBe(Number(t.active));
      expect(Number(rows[i].cohortSize)).toBe(Number(t.size));
      expect(Number(rows[i].retention)).toBeCloseTo(Number(t.active) / Number(t.size), 9);
    }
  });

  it('pivots into a cohort grid with one column per week', async () => {
    const grid = toGrid(await run());
    expect(grid.length).toBe(5);
    expect(Object.keys(grid[0])).toEqual(['cohort', 'size', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
    expect(grid[0].w1).toMatch(/^\d+%$/);
  });
});
