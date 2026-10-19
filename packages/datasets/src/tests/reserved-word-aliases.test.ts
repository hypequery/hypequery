/**
 * HQ-193: every alias the planner generates is quoted, so dimension and
 * measure names that are SQL keywords (or that an engine would case-fold)
 * survive as output names on every path.
 */

import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../clickhouse/src/index.js';
import { dataset } from '../dataset.js';
import { createDatasetClient } from '../executor.js';
import { dimension } from '../field.js';
import { divide, nullIfZero } from '../formulas.js';
import { measure } from '../measure.js';
import type { MetricHandle } from '../types.js';

const Events = dataset('events', {
  source: 'events',
  timeKey: 'time',
  dimensions: {
    time: dimension.timestamp({ column: 'event_at' }),
    group: dimension.string({ column: 'group_name' }),
    order: dimension.string({ sql: 'upper(order_code)', dependencies: ['order_code'] }),
    value: dimension.number(),
    limit: dimension.string({ column: 'limit_value' }),
    offset: dimension.string({ column: 'offset_value' }),
    having: dimension.string({ column: 'having_value' }),
  },
  measures: {
    rows: measure.count('value'),
    end: measure.sum('value'),
    window: measure.derived({ uses: { end: 'end', rows: 'rows' }, formula: ({ end, rows }) => divide(end, nullIfZero(rows)) }),
  },
});
const Ratio = Events.metric('range', {
  uses: { end: Events.metric('end', { measure: 'end' }), rows: Events.metric('rows', { measure: 'rows' }) },
  formula: ({ end, rows }) => divide(end, nullIfZero(rows)),
}) as MetricHandle;

const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://localhost:8123' }) });

describe('reserved-word names are quoted wherever the planner aliases them', () => {
  it('aggregate path: dimensions, measures, grouping and ordering', () => {
    const sql = client.toSQL(Events, { by: 'day', dimensions: ['group', 'order'], measures: ['rows', 'end'], orderBy: [{ field: 'end', direction: 'desc' }] });
    expect(sql).toContain('group_name AS `group`');
    expect(sql).toContain('upper(order_code) AS `order`');
    expect(sql).toContain('COUNT(value) AS `rows`');
    expect(sql).toContain('SUM(value) AS `end`');
    expect(sql).toContain('AS `period`');
    expect(sql).toMatch(/GROUP BY `period`, `group`, `order`/);
    expect(sql).toContain('ORDER BY `end` DESC');
  });

  it('derived measure path', () => {
    const sql = client.toSQL(Events, { dimensions: ['group'], measures: ['window'] });
    expect(sql).toContain('AS `rows`');
    expect(sql).toContain('(`end` / NULLIF(`rows`, 0)) AS `window`');
  });

  it('metric paths', () => {
    const base = client.toSQL(Events.metric('rowsMetric', { measure: 'rows' }) as never, { dimensions: ['group'], orderBy: [{ field: 'group', direction: 'asc' }] } as never);
    expect(base).toContain('AS `rowsMetric`');
    expect(base).toContain('ORDER BY `group` ASC');
    const derived = client.toSQL(Ratio as never, { dimensions: ['group'], orderBy: [{ field: 'range', direction: 'desc' }] } as never);
    expect(derived).toContain('SUM(value) AS `end`');
    expect(derived).toContain('SELECT `group`, (`end` / NULLIF(`rows`, 0)) AS `range` FROM base');
    expect(derived).toContain('ORDER BY `range` DESC');
  });

  it('derived metric grouped by clause keywords (limit, offset, having)', () => {
    const sql = client.toSQL(Ratio as never, { dimensions: ['limit', 'offset', 'having'], limit: 10 } as never);
    expect(sql).toContain('limit_value AS `limit`');
    expect(sql).toMatch(/GROUP BY `limit`, `offset`, `having`/);
    expect(sql).toContain('SELECT `limit`, `offset`, `having`, (`end`) / (NULLIF(`rows`, 0)) AS `range` FROM base');
  });
});
