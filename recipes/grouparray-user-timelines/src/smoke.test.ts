import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { analytics, db } from './client.js';
import { UserActivity } from './dataset.js';
import { DAY, USERS, run, runSummary, summaryQuery, toSQL } from './recipe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterAll(async () => {
  await db.close();
});

describe('groupArray user timelines recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured output exactly', async () => {
    const rows = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(rows).toEqual(captured);
  });

  it('matches the events read back with ORDER BY occurred_at, event_id', async () => {
    const events = await db.rawQuery<{ user_id: number; path: string }>(
      `SELECT user_id, path FROM events
       WHERE user_id IN (${USERS.join(', ')}) AND occurred_at BETWEEN '${DAY[0]}' AND '${DAY[1]}'
       ORDER BY user_id, occurred_at, event_id`,
    );
    for (const row of await run()) {
      const truth = events.filter((e) => Number(e.user_id) === Number(row.user_id)).map((e) => e.path);
      expect(row.paths).toEqual(truth);
      expect(row.firstThree).toEqual(truth.slice(0, 3));
      expect(row.gapsSeconds.length).toBe(truth.length);
      expect(row.gapsSeconds[0]).toBe(0);
      expect(row.gapsSeconds.every((gap) => gap >= 0)).toBe(true);
      expect(Number(row.events)).toBe(truth.length);
    }
  });

  it('agrees with the dataset summary on the first and last step', async () => {
    expect(analytics.toSQL(UserActivity, summaryQuery)).toContain('argMin(events.path, events.occurred_at)');
    const summary = await runSummary();
    const rows = await run();
    expect(summary.length).toBe(rows.length);
    for (const [i, row] of rows.entries()) {
      expect(Number(summary[i].userId)).toBe(Number(row.user_id));
      expect(summary[i].events).toBe(row.events);
      expect(summary[i].firstPath).toBe(row.paths[0]);
      expect(summary[i].lastPath).toBe(row.paths.at(-1));
    }
  });

  it('pitfall: plain groupArray is not in time order for most users; arraySort always is', async () => {
    const [counts] = await db.rawQuery<{ unsorted_raw: string; unsorted_sorted: string; users: string }>(
      `SELECT countIf(raw != arraySort(raw)) AS unsorted_raw,
              countIf(fixed != arraySort(fixed)) AS unsorted_sorted,
              count() AS users
       FROM (SELECT user_id, groupArray(occurred_at) AS raw,
                    arrayMap(e -> e.1, arraySort(groupArray((occurred_at, event_id)))) AS fixed
             FROM events GROUP BY user_id)`,
    );
    // The exact number changes from run to run (threads, parts); on the seed
    // it is in the thousands out of 5,033 users. It is never zero.
    expect(Number(counts.unsorted_raw)).toBeGreaterThan(0);
    expect(Number(counts.unsorted_sorted)).toBe(0);
    expect(Number(counts.users)).toBe(5033);
  });

  it('pitfall: groupArray(3) is any three values, groupArraySorted(3) the three earliest', async () => {
    const [row] = await db.rawQuery<{ differ: string }>(
      `SELECT countIf(any3 != first3) AS differ FROM (
         SELECT user_id, groupArray(3)((occurred_at, event_id)) AS any3,
                groupArraySorted(3)((occurred_at, event_id)) AS first3
         FROM events GROUP BY user_id)`,
    );
    expect(Number(row.differ)).toBeGreaterThan(0);
  });

  it('pitfall: same-second events exist, so the tuple needs event_id as a tiebreak', async () => {
    const [row] = await db.rawQuery<{ pairs: string; users: string }>(
      `SELECT count() AS pairs, uniqExact(user_id) AS users FROM (
         SELECT user_id, occurred_at FROM events GROUP BY user_id, occurred_at HAVING count() > 1)`,
    );
    expect(row).toEqual({ pairs: '57', users: '51' });
  });
});
