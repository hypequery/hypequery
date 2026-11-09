import { describe, expect, it, vi } from 'vitest';
import type { QueryBuilderFactoryLike } from '@hypequery/datasets';
import { createContextQueryBuilder } from './context-query-builder.js';

const base = (): QueryBuilderFactoryLike => ({ table: vi.fn(), rawQuery: vi.fn() });

describe('createContextQueryBuilder', () => {
  it('forwards the raw stream methods of the builder it was bound to', async () => {
    const rows = new ReadableStream<Record<string, unknown>[]>();
    const bytes = new ReadableStream<Uint8Array>();
    const real = { ...base(), rawStream: vi.fn().mockResolvedValue(rows), rawArrowStream: vi.fn().mockResolvedValue(bytes) };
    const context = createContextQueryBuilder();
    const builder = context.resolve(real);

    await expect(builder.rawStream!('SELECT 1', [1])).resolves.toBe(rows);
    await expect(builder.rawArrowStream!('SELECT 1')).resolves.toBe(bytes);
    expect(real.rawStream).toHaveBeenCalledWith('SELECT 1', [1]);
  });

  it('leaves them absent when the bound builder cannot stream', () => {
    const context = createContextQueryBuilder();
    const builder = context.resolve(base());
    expect(builder.rawStream).toBeUndefined();
    expect(builder.rawArrowStream).toBeUndefined();
  });
});
