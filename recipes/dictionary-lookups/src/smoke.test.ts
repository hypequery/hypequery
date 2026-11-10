import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { between, eq } from '@hypequery/datasets';
import { analytics, connection, db } from './client.js';
import { Events } from './dataset.js';
import { RANGE, run, runJoined, time, toSQL } from './recipe.js';
import { setup, teardown } from './setup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = createClient(connection);

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await teardown();
  await client.close();
  await db.close();
});

const dictRows = async () => (await run()).map((r) => [r.plan, r.region, String(r.events), String(r.tenants)]);
const joinRows = async () =>
  (await runJoined()).map((r) => [r['tenant.plan'], r['tenant.region'], String(r.events), String(r.tenants)]);

describe('dictionary lookups recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    const sql = toSQL();
    expect(`${sql}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
    expect(sql).not.toContain('JOIN');
  });

  it('returns the captured output exactly', async () => {
    expect(await run()).toEqual(JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8')));
  });

  it('returns the same rows as the JOIN version and as hand-written SQL', async () => {
    const rows = await dictRows();
    expect(rows).toHaveLength(16);
    expect(await joinRows()).toEqual(rows);
    const truth = await db.rawQuery<{ plan: string; region: string; events: string; tenants: string }>(
      `SELECT t.plan AS plan, t.region AS region, count() AS events, uniqExact(e.tenant_id) AS tenants
       FROM events AS e INNER JOIN tenants AS t ON t.tenant_id = e.tenant_id
       WHERE e.occurred_at BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'
       GROUP BY plan, region ORDER BY plan, region`,
    );
    expect(truth.map((t) => [t.plan, t.region, String(t.events), String(t.tenants)])).toEqual(rows);
  });

  it('filters on a dictGet dimension like any other', async () => {
    const result = await analytics.execute(Events, {
      measures: ['events'],
      filters: [eq('plan', 'free'), between('occurredAt', RANGE[0], RANGE[1])],
    });
    const free = (await run()).filter((r) => r.plan === 'free').reduce((n, r) => n + Number(r.events), 0);
    expect(Number(result.data[0].events)).toBe(free);
  });

  it('holds 200 tenants in memory and saves the JOIN its 200-row read', async () => {
    const res = await client.query({
      query: `SELECT status, element_count, type FROM system.dictionaries
              WHERE database = {db:String} AND name = 'dictionary_lookups_tenants'`,
      query_params: { db: connection.database },
      format: 'JSONEachRow',
    });
    const [dictionary] = await res.json<{ status: string; element_count: string | number; type: string }>();
    expect({ ...dictionary, element_count: Number(dictionary.element_count) }).toEqual({ status: 'LOADED', element_count: 200, type: 'Hashed' });
    const dict = await time('dictGet', 3);
    const join = await time('join', 3);
    expect(join.readRows - dict.readRows).toBe(200);
  });

  it('returns the attribute default, not NULL, for a missing key', async () => {
    const [row] = await db.rawQuery<{ plan: string; known: number; fallback: string; joined: string | null }>(
      `SELECT dictGet('dictionary_lookups_tenants', 'plan', 999999) AS plan,
              dictHas('dictionary_lookups_tenants', 999999) AS known,
              dictGetOrDefault('dictionary_lookups_tenants', 'plan', 999999, 'unknown') AS fallback,
              (SELECT any(t.plan) FROM (SELECT 999999 AS k) AS x LEFT JOIN tenants AS t ON t.tenant_id = x.k
               SETTINGS join_use_nulls = 1) AS joined`,
    );
    expect(row).toEqual({ plan: '', known: 0, fallback: 'unknown', joined: null });
  });

  it('serves the old value until the dictionary reloads; the JOIN sees the change at once', async () => {
    // Tenant 1 moves to enterprise in the dictionary's source table.
    await client.command({
      query: `ALTER TABLE dictionary_lookups_tenants_source UPDATE plan = 'enterprise' WHERE tenant_id = 1
              SETTINGS mutations_sync = 1`,
    });
    const lookup = async () =>
      (await db.rawQuery<{ plan: string }>(`SELECT dictGet('dictionary_lookups_tenants', 'plan', 1) AS plan`))[0].plan;
    expect(await lookup()).toBe('starter');
    expect(await joinRows()).not.toEqual(await dictRows());
    await client.command({ query: 'SYSTEM RELOAD DICTIONARY dictionary_lookups_tenants' });
    expect(await lookup()).toBe('enterprise');
    expect(await joinRows()).toEqual(await dictRows());
  });
});
