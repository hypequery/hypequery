import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './client.js';
import { COPY, createCopy, dropCopy, granules } from './cost.js';
import { decodeCursor, keysetPage, keysetPageQuery, offsetPageQuery } from './pagination.js';
import { cost, PAGE_SIZE, run, TENANT, toSQL } from './recipe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

beforeAll(async () => {
  await createCopy();
});

afterAll(async () => {
  await dropCopy();
  await db.close();
});

describe('cursor pagination recipe', () => {
  it('generates exactly the SQL shown on the page', async () => {
    expect(`${await toSQL()}\n`).toBe(fs.readFileSync(path.join(root, 'expected.sql'), 'utf8'));
  });

  it('returns the captured first two pages exactly', async () => {
    const pages = await run();
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'output.json'), 'utf8'));
    expect(pages).toEqual(captured);
    expect(pages.page1.length).toBe(PAGE_SIZE);
    expect(pages.page2.length).toBe(PAGE_SIZE);
    expect(decodeCursor(pages.cursor!)).toEqual({ occurredAt: '2026-10-31 16:49:06', eventId: '499194' });
  });

  it('walks the same rows as LIMIT/OFFSET, page for page', async () => {
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const keyset: Awaited<ReturnType<typeof keysetPage>> = await keysetPage(TENANT, PAGE_SIZE, cursor);
      const offset = await offsetPageQuery(TENANT, PAGE_SIZE, page).execute();
      expect(keyset.rows).toEqual(offset);
      cursor = keyset.nextCursor;
    }
  });

  it('keeps same-second events that a timestamp-only cursor would skip', async () => {
    // Tenant 47 has three events at 2026-10-30 14:03:47 (ids 966149, 486887, 55085).
    const after = { occurredAt: '2026-10-30 14:03:47', eventId: '486887' };
    const [next] = await keysetPageQuery(TENANT, 1, after).execute();
    expect(next.event_id).toBe('55085');
    const [timestampOnly] = await db.table('events').select(['event_id']).where('tenant_id', 'eq', TENANT)
      .where('occurred_at', 'lt', after.occurredAt).orderBy('occurred_at', 'DESC').orderBy('event_id', 'DESC').limit(1).execute();
    expect(timestampOnly.event_id).not.toBe('55085');
  });

  it('pins what the primary key leaves to read, and keyset reads stay flat while OFFSET grows', async () => {
    const rows = await cost();
    expect(rows.map(({ page, offsetGranules, keysetGranules }) => ({ page, offsetGranules, keysetGranules }))).toEqual([
      { page: 1, offsetGranules: 106, keysetGranules: 106 },
      { page: 21, offsetGranules: 106, keysetGranules: 105 },
      { page: 201, offsetGranules: 106, keysetGranules: 96 },
      { page: 1001, offsetGranules: 106, keysetGranules: 54 },
    ]);
    // Rows actually read depend a little on max_threads, so assert the shape:
    // OFFSET 50,000 must read at least 50,050 rows; keyset reads a few granules.
    const deep = rows.at(-1)!;
    expect(deep.offsetReadRows).toBeGreaterThanOrEqual(50_050);
    for (const row of rows) expect(row.keysetReadRows).toBeLessThan(20_000);
    expect(rows[2].offsetReadRows).toBeGreaterThan(4 * rows[2].keysetReadRows);
  });

  it('documents a ClickHouse 25.8 limit: a tuple comparison is not used by any index', async () => {
    const cursor = "('2026-07-09 18:05:48', 735428)";
    const base = `SELECT event_id FROM ${COPY} WHERE tenant_id = ${TENANT}`;
    const order = 'ORDER BY occurred_at DESC, event_id DESC LIMIT 50';
    const tuple = await granules(`${base} AND (occurred_at, event_id) < ${cursor} ${order}`);
    const expanded = await granules(
      `${base} AND (occurred_at < '2026-07-09 18:05:48' OR (occurred_at = '2026-07-09 18:05:48' AND event_id < 735428)) ${order}`,
    );
    expect(tuple).toEqual({ selected: 106, total: 977 });
    expect(expanded).toEqual({ selected: 54, total: 620 });
  });
});
