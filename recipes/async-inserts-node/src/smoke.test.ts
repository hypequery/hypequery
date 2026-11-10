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
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(pinned(results)).toEqual(captured);
    expect(results.map((r) => [r.strategy, r.parts, r.rows])).toEqual([
      ['per-row INSERT', 1000, 1000],
      ['client batches of 250', 4, 1000],
      ['async_insert, wait=1, 100 in flight', 10, 1000],
      ['async_insert, wait=0, then flush', 1, 1000],
    ]);
  });

  it('shows wait_for_async_insert = 0 returning before the rows exist', () => {
    const noWait = results.find((r) => r.strategy.includes('wait=0'))!;
    expect(noWait.rowsWhenCallsReturned).toBe(0);
    for (const r of results.filter((r) => !r.strategy.includes('wait=0'))) expect(r.rowsWhenCallsReturned).toBe(1000);
  });

  it('batches far faster than per-row inserts (timings are not pinned, only the order of magnitude)', () => {
    const [perRow, batched] = results;
    expect(batched.ms * 10).toBeLessThan(perRow.ms);
  });
});
