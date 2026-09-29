import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure, divide, multiply } from './index.js';
import { buildDatasetQuerySignature } from './cache/query-signature.js';
import { getDatasetCatalog } from './catalog.js';
import { buildDerivedDatasetSql } from './utils/dataset-derived-query.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';

const dimensions = { time: dimension.timestamp(), value: dimension.number() };
function model(multiplier: number) {
  return dataset('composed', { source: 'events', timeKey: 'time', dimensions, measures: {
    revenue: measure.sum('value'),
    ratio: measure.derived({ uses: { value: 'revenue' }, formula: ({ value }) => multiply(value, multiplier) }),
    twice: measure.derived({ uses: { ratio: 'ratio' }, formula: ({ ratio }) => multiply(ratio, 2) }),
    prior: measure.shift('twice', { amount: 1, unit: 'year' }),
  } });
}
describe('composed measure dependencies', () => {
  it('partitions caches by transitive formula AST, including captured constants', () => {
    const query = { by: 'month' as const, measures: ['prior'], filters: [{ field: 'time', operator: 'between' as const, value: ['2024-01-01', '2024-02-01'] }] };
    expect(buildDatasetQuerySignature(model(2), query)).not.toBe(buildDatasetQuerySignature(model(3), query));
    expect(buildDatasetQuerySignature(model(2), { measures: ['twice'] })).not.toBe(buildDatasetQuerySignature(model(3), { measures: ['twice'] }));
    expect(buildDatasetQuerySignature(model(2), { measures: ['revenue'] })).toBe(buildDatasetQuerySignature(model(3), { measures: ['revenue'] }));
  });
  it('expands nested ordinary formulas over aggregated leaf columns', () => {
    const builder = createQueryBuilder({ host: 'http://localhost:8123' });
    const sql = buildDerivedDatasetSql(model(3), { measures: ['twice'] }, { builderFactory: builder }, () => builder.table('events').select(['SUM(value) AS revenue'])).sql;
    expect(sql).toContain('(((`revenue` * 3)) * 2) AS `twice`');
  });
  it('propagates estimates through formulas and comparison wrappers', () => {
    const ds = dataset('estimates', { source: 'events', timeKey: 'time', dimensions, measures: {
      users: measure.approxCountDistinct('value'),
      ratio: measure.derived({ uses: { users: 'users' }, formula: ({ users }) => divide(users, 2) }),
      prior: measure.shift('ratio', { amount: 1, unit: 'year' }),
    } });
    expect(getDatasetCatalog(ds).measures.prior.approximate).toBe(true);
    expect(getDatasetCatalog(ds).measures.prior.aggregation).toBeUndefined();
  });
});
