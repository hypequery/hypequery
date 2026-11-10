import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { between } from '@hypequery/datasets';
import { afterAll, describe, expect, it } from 'vitest';
import { analytics, db } from './client.js';
import { Requests } from './dataset.js';
import { RANGE, run, toSQL } from './recipe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WHERE = `WHERE occurred_at BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'`;
const LABELS = ['< 100 ms', '100-250 ms', '250-500 ms', '500 ms-1 s', '>= 1 s'];

afterAll(async () => {
  await db.close();
});

const counts = (rows: Array<Record<string, unknown>>, key: string, value: string) =>
  Object.fromEntries(rows.map((r) => [String(r[key]), Number(r[value])]));

describe('multiIf bucketing recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured output exactly, buckets in bucket order', async () => {
    const rows = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(rows).toEqual(captured);
    expect(rows.map((r) => r.latencyBucket)).toEqual(LABELS);
  });

  it('CASE WHEN and roundDown give the same buckets; CASE is rewritten to multiIf', async () => {
    const rows = await run();
    const caseRows = await db.rawQuery<{ b: string; c: string }>(
      `SELECT CASE WHEN latency_ms < 100 THEN '< 100 ms' WHEN latency_ms < 250 THEN '100-250 ms'
                   WHEN latency_ms < 500 THEN '250-500 ms' WHEN latency_ms < 1000 THEN '500 ms-1 s'
                   ELSE '>= 1 s' END AS b, count() AS c FROM events ${WHERE} GROUP BY b`,
    );
    expect(counts(caseRows, 'b', 'c')).toEqual(counts(rows, 'latencyBucket', 'requests'));

    const lower = await db.rawQuery<{ lb: number; c: string }>(
      `SELECT roundDown(latency_ms, [0, 100, 250, 500, 1000]) AS lb, count() AS c FROM events ${WHERE} GROUP BY lb ORDER BY lb`,
    );
    expect(lower.map((r) => Number(r.c))).toEqual(rows.map((r) => Number(r.requests)));

    const explain = await db.rawQuery<{ explain: string }>(
      `EXPLAIN SYNTAX SELECT CASE WHEN latency_ms < 100 THEN 'fast' ELSE 'slow' END, CASE status_code WHEN 429 THEN 'limited' ELSE 'other' END FROM events`,
    );
    const text = explain.map((r) => r.explain).join('\n');
    expect(text).toContain("multiIf(latency_ms < 100, 'fast', 'slow')");
    expect(text).toContain("caseWithExpression(status_code, 429, 'limited', 'other')");
  });

  it('status classes from the dataset, 429 tested before >= 400', async () => {
    const rows = (
      await analytics.execute(Requests, {
        dimensions: ['statusClass'],
        measures: ['requests'],
        filters: [between('occurredAt', RANGE[0], RANGE[1])],
        orderBy: [{ field: 'statusClass', direction: 'asc' }],
      })
    ).data;
    expect(counts(rows, 'statusClass', 'requests')).toEqual({ client_error: 1042, ok: 30409, rate_limited: 95, server_error: 788 });
  });

  it('pitfall: first true condition wins, so a wide condition first swallows the rest', async () => {
    const wrongLatency = await db.rawQuery<{ b: string; c: string }>(
      `SELECT multiIf(latency_ms < 500, '250-500 ms', latency_ms < 100, '< 100 ms', 'other') AS b, count() AS c
       FROM events ${WHERE} GROUP BY b ORDER BY b`,
    );
    expect(counts(wrongLatency, 'b', 'c')).toEqual({ '250-500 ms': 28450, other: 3884 });
    const wrongStatus = await db.rawQuery<{ b: string; c: string }>(
      `SELECT multiIf(status_code >= 400, 'client_error', status_code = 429, 'rate_limited', status_code >= 500, 'server_error', 'ok') AS b,
              count() AS c FROM events ${WHERE} GROUP BY b ORDER BY b`,
    );
    // No rate_limited and no server_error: both are >= 400.
    expect(counts(wrongStatus, 'b', 'c')).toEqual({ client_error: 1925, ok: 30409 });
  });

  it('pitfall: labels sort as strings, not as buckets', async () => {
    const rows = (
      await analytics.execute(Requests, {
        dimensions: ['latencyBucket'],
        measures: ['requests'],
        filters: [between('occurredAt', RANGE[0], RANGE[1])],
        orderBy: [{ field: 'latencyBucket', direction: 'asc' }],
      })
    ).data;
    expect(rows.map((r) => r.latencyBucket)).toEqual(['100-250 ms', '250-500 ms', '500 ms-1 s', '< 100 ms', '>= 1 s']);
  });

  it('pitfall: boundaries. 191 requests at exactly 100 ms land in 100-250 ms', async () => {
    const [row] = await db.rawQuery<{ at100: string; bucket: string }>(
      `SELECT count() AS at100, any(multiIf(latency_ms < 100, '< 100 ms', latency_ms < 250, '100-250 ms', 'other')) AS bucket
       FROM events ${WHERE} AND latency_ms = 100`,
    );
    expect(row).toEqual({ at100: '191', bucket: '100-250 ms' });
  });

  it('pitfall: branch types must share a supertype; transform without a default passes values through', async () => {
    await expect(db.rawQuery(`SELECT multiIf(latency_ms < 100, 'fast', 1) FROM events LIMIT 1`)).rejects.toThrow(/no supertype/i);
    const [row] = await db.rawQuery<Record<string, unknown>>(
      `SELECT toTypeName(multiIf(latency_ms < 100, 'fast', NULL)) AS nullable_type,
              transform(status_code, [429], [1]) AS passthrough,
              transform(status_code, [429], ['rate_limited'], 'other') AS with_default,
              roundDown(toUInt32(5), [10, 100]) AS below_first_bound
       FROM events WHERE status_code = 200 LIMIT 1`,
    );
    expect(row).toEqual({ nullable_type: 'Nullable(String)', passthrough: 200, with_default: 'other', below_first_bound: 10 });
  });
});
