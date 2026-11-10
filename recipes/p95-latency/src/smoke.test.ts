import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from './client.js';
import { RANGE, run, toSQL } from './recipe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterAll(async () => {
  await db.close();
});

describe('p95 latency recipe', () => {
  it('generates exactly the SQL shown on the page', () => {
    expect(`${toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns one row per event type, slowest p95 first, close to the captured output', async () => {
    const rows = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8')) as typeof rows;
    expect(rows.map((r) => r.eventType)).toEqual(captured.map((r) => r.eventType));
    for (const [i, row] of rows.entries()) {
      expect(Number(row.events)).toBe(Number(captured[i].events));
      // quantile() is approximate: allow 2% drift against the captured value.
      for (const key of ['p50LatencyMs', 'p95LatencyMs', 'p99LatencyMs'] as const) {
        expect(Number(row[key])).toBeCloseTo(Number(captured[i][key]), -Math.log10(Number(captured[i][key]) * 0.02));
      }
    }
    const p95s = rows.map((r) => Number(r.p95LatencyMs));
    expect([...p95s].sort((a, b) => b - a)).toEqual(p95s);
  });

  it('is within 3% of the exact percentile computed by hand-written SQL', async () => {
    const rows = await run();
    const exact = await db.rawQuery<{ event_type: string; p95: number }>(
      `SELECT event_type, quantileExact(0.95)(latency_ms) AS p95 FROM events
       WHERE occurred_at BETWEEN '${RANGE[0]}' AND '${RANGE[1]}' GROUP BY event_type`,
    );
    const byType = new Map(exact.map((r) => [r.event_type, Number(r.p95)]));
    for (const row of rows) {
      const truth = byType.get(String(row.eventType))!;
      expect(Math.abs(Number(row.p95LatencyMs) - truth) / truth).toBeLessThan(0.03);
    }
  });
});
