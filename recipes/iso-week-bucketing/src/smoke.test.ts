import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { between } from '@hypequery/datasets';
import { afterAll, describe, expect, it } from 'vitest';
import { analytics, db } from './client.js';
import { Events } from './dataset.js';
import { RANGE, run, toSQL } from './recipe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterAll(async () => {
  await db.close();
});

describe('ISO week bucketing recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured output exactly (counts and min/max are exact)', async () => {
    const rows = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(rows).toEqual(captured);
    // Every bucket starts on a Monday and ends on the following Sunday.
    for (const row of rows) {
      expect(new Date(`${row.isoWeekStart}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(new Date(`${String(row.firstEventAt).slice(0, 10)}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(new Date(`${String(row.lastEventAt).slice(0, 10)}T00:00:00Z`).getUTCDay()).toBe(0);
    }
    // ISO week 1 of 2026 starts in December 2025.
    expect(rows.find((r) => r.isoWeek === '2026-W01')?.isoWeekStart).toBe('2025-12-29');
  });

  it('matches hand-written SQL using toYearWeek(..., 3), the numeric ISO year-week', async () => {
    const truth = await db.rawQuery<{ yw: number; events: string }>(
      `SELECT toYearWeek(occurred_at, 3) AS yw, count() AS events FROM events
       WHERE occurred_at BETWEEN '${RANGE[0]}' AND '${RANGE[1]}' GROUP BY yw ORDER BY yw`,
    );
    const rows = await run();
    expect(rows.map((r) => String(r.isoWeek).replace('-W', ''))).toEqual(truth.map((t) => String(t.yw)));
    expect(rows.map((r) => r.events)).toEqual(truth.map((t) => String(t.events)));
  });

  it('pitfall: %Y instead of %G splits ISO week 2026-W01 into two labels', async () => {
    const split = await db.rawQuery<{ label: string; events: string }>(
      `SELECT formatDateTime(occurred_at, '%Y-W%V') AS label, count() AS events FROM events
       WHERE occurred_at BETWEEN '2025-12-29 00:00:00' AND '2026-01-04 23:59:59'
       GROUP BY label ORDER BY label`,
    );
    expect(split).toEqual([
      { label: '2025-W01', events: '6418' },
      { label: '2026-W01', events: '6002' },
    ]);
  });

  it("pitfall: the dataset's by: 'week' grain is toStartOfWeek mode 0, Sunday weeks", async () => {
    const weekly = { measures: ['events'], by: 'week', filters: [between('occurredAt', RANGE[0], RANGE[1])] } as const;
    expect(analytics.toSQL(Events, weekly)).toContain("toStartOfWeek(toDateTime64(events.occurred_at, 9, 'UTC'))");
    const rows = (await analytics.execute(Events, weekly)).data;
    // Five Monday-to-Sunday weeks become six Sunday-to-Saturday buckets, the last one a single day.
    expect(rows.map((r) => String(r.period).slice(0, 10))).toEqual([
      '2025-12-14', '2025-12-21', '2025-12-28', '2026-01-04', '2026-01-11', '2026-01-18',
    ]);
    expect(rows.map((r) => r.events)).toEqual(['11094', '12060', '12389', '12903', '12998', '895']);
  });

  it('pitfall: a week number without its ISO year merges 2025-W44 and 2026-W44', async () => {
    const [merged] = await db.rawQuery<{ events: string }>(
      `SELECT count() AS events FROM events WHERE toISOWeek(occurred_at) = 44`,
    );
    const separate = await db.rawQuery<{ label: string; events: string }>(
      `SELECT formatDateTime(occurred_at, '%G-W%V') AS label, count() AS events FROM events
       WHERE toISOWeek(occurred_at) = 44 GROUP BY label ORDER BY label`,
    );
    expect(merged.events).toBe('31642');
    expect(separate).toEqual([
      { label: '2025-W44', events: '1452' },
      { label: '2026-W44', events: '30190' },
    ]);
  });

  it('pitfall: toWeek and toYearWeek default to mode 0, not ISO', async () => {
    const [row] = await db.rawQuery<Record<string, number>>(
      `SELECT toWeek(toDate('2026-01-01')) AS week_mode0, toWeek(toDate('2026-01-01'), 3) AS week_iso,
              toYearWeek(toDate('2026-01-01')) AS yw_mode0, toYearWeek(toDate('2026-01-01'), 3) AS yw_iso,
              toISOWeek(toDate('2026-01-01')) AS iso_week`,
    );
    expect(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]))).toEqual({
      week_mode0: 0, week_iso: 1, yw_mode0: 202552, yw_iso: 202601, iso_week: 1,
    });
  });
});
