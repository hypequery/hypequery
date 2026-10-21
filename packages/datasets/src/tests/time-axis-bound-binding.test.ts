/**
 * Time-measure axis bounds come from the caller's time filter, so they are
 * bound as parameters and never written into SQL text (specs/datasets/0001).
 */

import { describe, expect, it } from 'vitest';
import { createQueryBuilder, substituteParameters } from '../../../clickhouse/src/index.js';
import { dataset } from '../dataset.js';
import { createDatasetClient } from '../executor.js';
import { dimension } from '../field.js';
import { divide, nullIfZero } from '../formulas.js';
import { measure } from '../measure.js';
import type { DatasetQuery } from '../types.js';

const Events = dataset('events', {
  source: 'events',
  timeKey: 'time',
  dimensions: { time: dimension.timestamp({ column: 'event_at' }), amount: dimension.number() },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('amount'),
    aov: measure.derived({ uses: { revenue: 'revenue', orders: 'orders' }, formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)) }),
    rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }),
    prior: measure.shift('revenue', { amount: 1, unit: 'month' }),
    priorAov: measure.shift('aov', { amount: 1, unit: 'month' }),
  },
});

const LOWER = '2026-01-01T00:00:00+05:00';
const UPPER = '2026-02-01 12:30:00.250';
const paths: Record<string, DatasetQuery> = {
  window: { by: 'day', measures: ['rolling'] },
  shift: { by: 'day', measures: ['revenue', 'prior'] },
  composite: { by: 'month', measures: ['priorAov'] },
};

function recordingClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = createQueryBuilder({
    adapter: {
      name: 'recording',
      async query<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return [] as T[];
      },
    },
  });
  return { calls, client: createDatasetClient({ queryBuilder: db }) };
}

describe('time-measure axis bounds are bound, not inlined', () => {
  it.each(Object.entries(paths))('%s: statement and preflight', async (_name, base) => {
    const { calls, client } = recordingClient();
    const query = { ...base, filters: [{ field: 'time', operator: 'between' as const, value: [LOWER, UPPER] }] };
    const compilation = client.compileDataset(Events, query as never);
    for (const statement of [compilation, ...compilation.preflightStatements]) {
      expect(statement.sql).not.toContain(LOWER);
      expect(statement.sql).not.toContain(UPPER);
      expect(statement.sql).toContain('parseDateTime64BestEffort(?, 9,');
      expect(statement.parameters).toEqual([LOWER, UPPER]);
      // ClickHouse executes the same statement it did when bounds were inlined.
      expect(substituteParameters(statement.sql, statement.parameters))
        .toContain(`parseDateTime64BestEffort('${LOWER}', 9,`);
    }

    await client.execute(Events, query as never);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.sql).not.toContain(LOWER);
      expect(call.params).toEqual([LOWER, UPPER]);
    }
  });

  it('keeps exclusive bounds bound', () => {
    const { client } = recordingClient();
    const compilation = client.compileDataset(Events, {
      by: 'day', measures: ['rolling'],
      filters: [{ field: 'time', operator: 'gt', value: LOWER }, { field: 'time', operator: 'lt', value: UPPER }],
    } as never);
    expect(compilation.sql).not.toContain(LOWER);
    expect(compilation.parameters).toEqual([LOWER, UPPER]);
  });
});
