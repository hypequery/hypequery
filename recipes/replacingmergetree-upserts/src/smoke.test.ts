import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { Tenants, TenantsLatest } from './dataset.js';
import { run, snapshot, toSQL, type Snapshot } from './recipe.js';
import { optimize, setup, teardown } from './setup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const states = read('states.json') as { beforeOptimize: Snapshot; afterOptimize: Snapshot };
const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await teardown();
  await db.close();
});

// Tests run in order: the first group sees merges held, the last runs OPTIMIZE.
describe('replacingmergetree upserts recipe', () => {
  it('generates exactly the SQL shown on the page, reading FINAL', () => {
    const sql = toSQL();
    expect(`${sql}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
    expect(sql).toContain('FROM replacingmergetree_upserts_tenants FINAL');
  });

  it('returns the captured output, which matches the upserts applied by hand to the seed', async () => {
    const rows = await run();
    expect(rows).toEqual(read('output.json'));
    // Ground truth: every 25th tenant deleted, every other 10th moved up a plan.
    const truth = await db.rawQuery<{ plan: string; n: string }>(
      `SELECT if(tenant_id % 10 = 0 AND plan != 'enterprise',
                 multiIf(plan = 'free', 'starter', plan = 'starter', 'growth', 'enterprise'), plan) AS plan,
              count() AS n
       FROM tenants WHERE tenant_id % 25 != 0 GROUP BY plan ORDER BY plan`,
    );
    expect(rows.map((r) => [r.plan, Number(r.tenants)])).toEqual(truth.map((t) => [t.plan, Number(t.n)]));
  });

  it('before OPTIMIZE: raw rows count every version, FINAL and argMax agree', async () => {
    const before = await snapshot();
    expect(before).toEqual(states.beforeOptimize);
    expect(total(before.rawRows)).toBe(247);
    expect(total(before.final)).toBe(192);
    expect(before.argMax).toEqual(before.final);
  });

  it('a dataset filter is applied after FINAL / after argMax; filtering before argMax resurrects old versions', async () => {
    const free = [eq('plan', 'free')];
    const final = await analytics.execute(Tenants, { measures: ['tenants'], filters: free });
    const latest = await analytics.execute(TenantsLatest, { measures: ['tenants'], filters: free });
    expect(Number(final.data[0].tenants)).toBe(73);
    expect(Number(latest.data[0].tenants)).toBe(73);
    const [wrong] = await db.rawQuery<{ n: string }>(
      `SELECT count() AS n FROM (
         SELECT tenant_id FROM replacingmergetree_upserts_tenants WHERE plan = 'free'
         GROUP BY tenant_id HAVING argMax(is_deleted, version) = 0)`,
    );
    expect(Number(wrong.n)).toBe(91);
  });

  it('after OPTIMIZE FINAL: one part, tombstones still stored, FINAL unchanged', async () => {
    await optimize();
    const after = await snapshot();
    expect(after).toEqual(states.afterOptimize);
    expect(total(after.rawRows)).toBe(200);
    expect(after.final).toEqual(states.beforeOptimize.final);
    const [parts] = await db.rawQuery<{ parts: string; deleted: string }>(
      `SELECT uniqExact(_part) AS parts, countIf(is_deleted = 1) AS deleted FROM replacingmergetree_upserts_tenants`,
    );
    expect(Number(parts.parts)).toBe(1);
    expect(Number(parts.deleted)).toBe(8);
  });
});
