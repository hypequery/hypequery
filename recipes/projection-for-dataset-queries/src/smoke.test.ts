import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { between } from '@hypequery/datasets';
import { db } from './client.js';
import { explain, profile, query, RANGE, run, toSQL, userQuery } from './recipe.js';
import { setup, teardown } from './setup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await teardown();
  await db.close();
});

describe('projection for dataset queries recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured output exactly, and it matches hand-written SQL over the seed events table', async () => {
    const rows = await run();
    expect(rows).toEqual(JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8')));
    const truth = await db.rawQuery<{ day: string; events: string; total: string }>(
      `SELECT toDate(occurred_at) AS day, count() AS events, sum(latency_ms) AS total FROM events
       WHERE toDate(occurred_at) BETWEEN '${RANGE[0]}' AND '${RANGE[1]}' GROUP BY day ORDER BY day`,
    );
    expect(rows.map((r) => [r.day, String(r.events), String(r.totalLatencyMs)])).toEqual(
      truth.map((t) => [t.day, String(t.events), String(t.total)]),
    );
  });

  it('is served by the aggregate projection, reading a tiny fraction of the rows', async () => {
    const on = await profile(query, true);
    const off = await profile(query, false);
    expect(on.projections).toEqual(['daily_by_type']);
    expect(off.projections).toEqual([]);
    expect(on.rows).toEqual(off.rows);
    expect(on.readRows).toBeLessThan(off.readRows / 100);
    expect(await explain(query)).toContain('ReadFromMergeTree (daily_by_type)');
  });

  it('serves a lookup by user from the by_user projection, with the same answer as the seed', async () => {
    const on = await profile(userQuery, true);
    const off = await profile(userQuery, false);
    expect(on.projections).toEqual(['by_user']);
    expect(on.rows).toEqual(off.rows);
    expect(off.readRows).toBe(1_000_000);
    expect(on.readRows).toBeLessThan(off.readRows / 5);
    const truth = await db.rawQuery<{ event_type: string; n: string }>(
      `SELECT event_type, count() AS n FROM events WHERE user_id = 42 GROUP BY event_type ORDER BY n DESC, event_type`,
    );
    expect((on.rows as Array<{ eventType: string; events: string }>).map((r) => [r.eventType, String(r.events)])).toEqual(
      truth.map((t) => [t.event_type, String(t.n)]),
    );
  });

  it('falls back to the base table when the query filters on the raw timestamp', async () => {
    // Same daily grouping, but filtered on occurred_at: the projection only
    // stores toDate(occurred_at), so it cannot answer a sub-day range.
    const raw = await profile(
      { ...query, filters: [between('occurredAt', `${RANGE[0]} 00:00:00`, `${RANGE[1]} 23:59:59`)] },
      true,
    );
    expect(raw.projections).not.toContain('daily_by_type');
    // by: 'day' buckets with toStartOfDay(toDateTime64(occurred_at, ...)), not the projection key either.
    const bucketed = await profile({ by: 'day', measures: ['events'] }, true);
    expect(bucketed.projections).not.toContain('daily_by_type');
  });
});
