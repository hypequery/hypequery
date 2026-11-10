import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { analytics, db } from './client.js';
import { TenantPaths } from './dataset.js';
import { RANGE, TENANTS, TOP_N, run, runForTenant, toSQL, topPathsForTenant } from './recipe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterAll(async () => {
  await db.close();
});

/** Per-tenant path counts ranked three ways, as hand-written SQL. */
const ranked = (fn: 'row_number' | 'rank' | 'dense_rank') => `
  SELECT tenant_id, path, count() AS events,
         ${fn}() OVER (PARTITION BY tenant_id ORDER BY events DESC, path ASC) AS position
  FROM events
  WHERE tenant_id IN (${TENANTS.join(', ')}) AND occurred_at BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'
  GROUP BY tenant_id, path
  QUALIFY position <= ${TOP_N}
  ORDER BY tenant_id, events DESC, path`;

describe('top N per group with LIMIT BY', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured output exactly, three rows per tenant', async () => {
    const rows = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(rows).toEqual(captured);
    expect(rows.length).toBe(TENANTS.length * TOP_N);
  });

  it('equals row_number() <= 3 over the same ORDER BY', async () => {
    const truth = await db.rawQuery<{ tenant_id: number; path: string; events: string }>(ranked('row_number'));
    const rows = await run();
    expect(rows.map((r) => [Number(r.tenant_id), r.path, String(r.events)])).toEqual(
      truth.map((t) => [Number(t.tenant_id), t.path, String(t.events)]),
    );
  });

  it('pitfall: ties. rank() keeps 4 rows for tenant 1, dense_rank() keeps all 10 of its paths', async () => {
    const byTenant = (rows: Array<{ tenant_id: number }>) =>
      TENANTS.map((t) => rows.filter((r) => Number(r.tenant_id) === t).length);
    // Tenant 1 has /explore, /export and /reports tied on 2 events for second place.
    // LIMIT 3 BY keeps /explore and /export because the ORDER BY breaks the tie on path.
    expect(byTenant(await run())).toEqual([3, 3, 3, 3, 3]);
    // rank() ignores the path tiebreak when the window orders by events only.
    const rank = await db.rawQuery<{ tenant_id: number }>(ranked('rank').replace('events DESC, path ASC) AS position', 'events DESC) AS position'));
    expect(byTenant(rank)).toEqual([4, 3, 3, 3, 3]);
    const dense = await db.rawQuery<{ tenant_id: number }>(ranked('dense_rank').replace('events DESC, path ASC) AS position', 'events DESC) AS position'));
    // dense_rank() also lets tenant 2 through with 4 (53, 24, 24, 23).
    expect(byTenant(dense)).toEqual([10, 4, 3, 3, 3]);
  });

  it('pitfall: LIMIT BY then LIMIT caps the total, not the per-group count', async () => {
    const rows = await db.rawQuery(`${toSQL()} LIMIT 5`);
    expect(rows.length).toBe(5);
  });

  it('one tenant: the dataset query renders a plain ORDER BY ... LIMIT', async () => {
    expect(analytics.toSQL(TenantPaths, topPathsForTenant(1))).toBe(
      "SELECT events.path AS `path`, COUNT(events.event_id) AS `events` FROM events WHERE events.tenant_id = ? AND toDateTime64(events.occurred_at, 9, 'UTC') BETWEEN ? AND ? GROUP BY `path` ORDER BY `events` DESC, `path` ASC LIMIT 3",
    );
    const rows = await runForTenant(1);
    const all = await run();
    expect(rows).toEqual(all.filter((r) => Number(r.tenant_id) === 1).map((r) => ({ path: r.path, events: String(r.events) })));
  });
});
