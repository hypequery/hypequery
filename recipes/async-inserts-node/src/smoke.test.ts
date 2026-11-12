import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from './client.js';
import { pinned, run, sentSQL, type StrategyResult } from './recipe.js';
import { dropTable } from './table.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterAll(async () => {
  await dropTable();
  await db.close();
});

describe('async inserts recipe', () => {
  it('sends exactly the INSERT shown on the page, with async_insert as a setting', async () => {
    const sent = await sentSQL();
    expect(`${sent.query}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
    expect(sent.asyncInsert).toBe('1');
    // The client's summary counts rows written by the INSERT itself; an async
    // insert's rows are written later by the flush, so it reports 0 even with wait=1.
    expect(sent.writtenRows).toBe('0');
  });

  let results: StrategyResult[];

  it('lands every row with each strategy, and pins the parts each one creates', async () => {
    results = await run();
    // The wait=1 strategy's part count depends on how many inserts land in each
    // 500 ms flush window, so it varies with runner speed: bound it, pin the rest.
    const asyncWait = results.find((r) => r.strategy.includes('wait=1'))!;
    expect(asyncWait.parts).toBeGreaterThanOrEqual(1);
    expect(asyncWait.parts).toBeLessThanOrEqual(100);
    const unpinWaitParts = (rows: Array<{ strategy: string; parts: number }>) =>
      rows.map((r) => (r.strategy.includes('wait=1') ? { ...r, parts: 'varies' } : r));
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(unpinWaitParts(pinned(results))).toEqual(unpinWaitParts(captured));
    expect(results.map((r) => [r.strategy, r.rows])).toEqual([
      ['per-row INSERT', 1000],
      ['client batches of 250', 1000],
      ['async_insert, wait=1, 100 in flight', 1000],
      ['async_insert, wait=0, then flush', 1000],
    ]);
    expect(results[0].parts).toBe(1000);
    expect(results[1].parts).toBe(4);
    expect(results[3].parts).toBe(1);
  });

  it('shows wait_for_async_insert = 0 returning before the rows exist', () => {
    const noWait = results.find((r) => r.strategy.includes('wait=0'))!;
    expect(noWait.rowsWhenCallsReturned).toBe(0);
    for (const r of results.filter((r) => !r.strategy.includes('wait=0'))) expect(r.rowsWhenCallsReturned).toBe(1000);
  });
});
