import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { connection, db } from './client.js';
import { run, toSQL } from './recipe.js';
import { materialize, SEED_TODAY, setup, teardown } from './setup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const states = read('states.json') as { beforeMaterialize: unknown; afterMaterialize: unknown };

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await teardown();
  await db.close();
});

// Tests run in order: the first sees the rules declared but not applied.
describe('ttl data retention recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('removes nothing until the TTL is materialized', async () => {
    expect(await run()).toEqual(states.beforeMaterialize);
    const [seed] = await db.rawQuery<{ n: string }>('SELECT count() AS n FROM events');
    const rows = await run();
    expect(rows.reduce((n, r) => n + Number(r.events), 0)).toBe(Number(seed.n));
  });

  it('after MATERIALIZE TTL returns the captured output on any day the recipe runs', async () => {
    await materialize();
    const rows = await run();
    expect(rows).toEqual(read('output.json'));
    expect(rows).toEqual(states.afterMaterialize);
  });

  it('matches the retention policy applied by hand to the seed events', async () => {
    // free: 30 days, starter: 180 days, others: forever; paths: 7 days. All
    // measured from the seed's today. A row dated D expires when D + N days
    // is reached, so it survives while D + N > SEED_TODAY.
    const truth = await db.rawQuery<{ plan: string; events: string; with_path: string; oldest: string }>(
      `WITH toDate('${SEED_TODAY}') AS today
       SELECT t.plan AS plan, count() AS events,
              countIf(toDate(e.occurred_at) + 7 > today) AS with_path,
              toString(min(e.occurred_at)) AS oldest
       FROM events AS e INNER JOIN tenants AS t ON t.tenant_id = e.tenant_id
       WHERE multiIf(t.plan = 'free', toDate(e.occurred_at) + 30 > today,
                     t.plan = 'starter', toDate(e.occurred_at) + 180 > today, 1)
       GROUP BY plan ORDER BY plan`,
    );
    const rows = await run();
    expect(rows.map((r) => [r.plan, String(r.events), String(r.eventsWithPath), r.oldestEvent])).toEqual(
      truth.map((t) => [t.plan, String(t.events), String(t.with_path), t.oldest]),
    );
  });

  it('keeps an expired row visible until a TTL merge or MATERIALIZE TTL removes it', async () => {
    // TTL is not a read filter. An insert that is already past its TTL is
    // stored and returned by queries; a background TTL merge usually removes
    // it soon after, so hold those to make the test deterministic.
    const client = createClient(connection);
    const count = async () => Number((await db.rawQuery<{ n: string }>('SELECT count() AS n FROM ttl_data_retention_events'))[0].n);
    try {
      const before = await count();
      await client.command({ query: 'SYSTEM STOP TTL MERGES ttl_data_retention_events' });
      await client.command({
        query: `INSERT INTO ttl_data_retention_events VALUES (9000000001, 1, 'free', 'login', '/login', 100, '2026-01-15 12:00:00')`,
      });
      expect(await count()).toBe(before + 1);
      await client.command({ query: 'SYSTEM START TTL MERGES ttl_data_retention_events' });
      await materialize();
      expect(await count()).toBe(before);
    } finally {
      await client.close();
    }
  });
});
