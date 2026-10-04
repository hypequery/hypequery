import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { dataset, dimension, measure, add, belongsTo, hasOne, hasMany, createDatasetClient, getDatasetCatalog, projectAgentSafeCatalog, buildDatasetInputSchema } from './index.js';
import { validateDatasetQuery } from './dataset-query.js';
import { createInMemoryBackend } from './in-memory-backend.js';

const Targets = dataset('targets', {
  source: 'targets', timeKey: 'created_at',
  tenantKey: 'tenant_id',
  dimensions: { id: dimension.number(), value: dimension.number({ column: 'score' }), tier: dimension.string(), computed: dimension.number({ sql: 'score + 1' }) },
  measures: {
    unique: measure.countDistinct('id'), estimated: measure.approxCountDistinct('id'),
    lowest: measure.min('value'), highest: measure.max('value'),
    latest: measure.argMax('tier', 'value'), earliest: measure.argMin('tier', 'value'),
    total: measure.sum('value'), count: measure.count('id'), mean: measure.avg('value'),
    gold: measure.countDistinct('id', { filters: [{ field: 'tier', operator: 'eq', value: 'gold' }] }),
    raw: measure.min('score', { sql: 'score + 1' }), computed: measure.min('computed'),
    derived: measure.derived({ uses: { total: 'total' }, formula: ({ total }) => add(total, total) }),
    trailing: measure.trailing('total', { amount: 7, unit: 'day' }),
    shift: measure.shift('total', { amount: 1, unit: 'day' }),
  },
});
const Sources = dataset('sources', {
  source: 'sources', dimensions: { status: dimension.string(), amount: dimension.number() },
  measures: { total: measure.sum('amount'), twice: measure.derived({ uses: { total: 'total' }, formula: ({ total }) => add(total, total) }) },
  relationships: { target: belongsTo(() => Targets, { from: 'target_id', to: 'id' }), profile: hasOne(() => Targets, { from: 'id', to: 'id' }), many: hasMany(() => Targets, { from: 'id', to: 'id' }) },
});
const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://localhost:8123' }) });
const context = { runtime: { tenant: { id: 'a' } } };

describe('relationship measures', () => {
  it.each(['unique', 'estimated', 'lowest', 'highest', 'latest', 'earliest', 'gold'])('allows duplicate-insensitive belongsTo %s', name => {
    expect(validateDatasetQuery(Sources, { measures: [`target.${name}`] }, context).valid).toBe(true);
  });
  it.each(['total', 'count', 'mean'])('requires hasOne for %s', name => {
    expect(validateDatasetQuery(Sources, { measures: [`target.${name}`] }, context).errors.join(' ')).toMatch(/repeated target rows/);
    expect(validateDatasetQuery(Sources, { measures: [`profile.${name}`] }, context).valid).toBe(true);
  });
  it.each(['many.unique', 'target.next.unique', 'target.derived', 'target.trailing', 'target.shift', 'target.raw', 'target.computed', 'target.constructor', 'constructor.unique'])('rejects unsupported %s', name => {
    expect(validateDatasetQuery(Sources, { measures: [name] }, context).valid).toBe(false);
  });
  it('requires tenancy even when only a target measure is selected', () => {
    expect(validateDatasetQuery(Sources, { measures: ['target.unique'] }).errors.join(' ')).toMatch(/requires runtime tenant/);
  });
  it('shares one guarded join across dimensions, measures and filters', () => {
    const sql = client.toSQL(Sources, { dimensions: ['target.tier'], measures: ['total', 'target.unique', 'target.gold'], filters: [{ field: 'target.tier', operator: 'eq', value: 'gold' }], orderBy: [{ field: 'target.unique', direction: 'desc' }] }, context);
    expect((sql.match(/LEFT ANY JOIN/g) ?? []).length).toBe(1);
    expect(sql).toContain('toNullable(1) AS `_hq_match`');
    expect(sql).toContain('isNotNull(target._hq_match)');
    expect(sql).toContain('target.tenant_id =');
    expect(sql).toContain("target.tier = 'gold'");
    expect(sql).toContain('ORDER BY `target.unique` DESC');
  });
  it('guards the target input for count', () => {
    expect(client.toSQL(Sources, { measures: ['profile.count'] }, context)).toContain('COUNT(if(isNotNull(profile._hq_match), profile.id, NULL))');
  });
  it('avoids match-marker collisions with authored target columns', () => {
    const target = dataset('markerTarget', { source: 'marker_targets', dimensions: { id: dimension.number(), _hq_match: dimension.number() }, measures: { unique: measure.countDistinct('id') } });
    const source = dataset('markerSource', { source: 'marker_sources', dimensions: { id: dimension.number() }, relationships: { target: belongsTo(() => target, { from: 'id', to: 'id' }) } });
    const sql = client.toSQL(source, { measures: ['target.unique'] });
    expect(sql).toContain('toNullable(1) AS `_hq_match_`');
    expect(sql).toContain('isNotNull(target._hq_match_)');
  });
  it('preserves related measures beside a local derived projection', () => {
    const sql = client.toSQL(Sources, { measures: ['twice', 'target.unique'] }, context);
    expect(sql).toContain('AS `target.unique`');
    expect(sql).toContain('isNotNull(target._hq_match)');
  });
  it('advertises only safe names with approximate metadata and accepts them in schemas', () => {
    const catalog = getDatasetCatalog(Sources);
    expect(Object.keys(catalog.relationships.target.measures ?? {})).toEqual(['target.unique', 'target.estimated', 'target.lowest', 'target.highest', 'target.latest', 'target.earliest', 'target.gold']);
    expect(catalog.relationships.target.measures?.['target.estimated'].approximate).toBe(true);
    expect(catalog.relationships.many.measures).toBeUndefined();
    expect(catalog.orderableFields).toContain('target.unique');
    expect(projectAgentSafeCatalog({ sources: Sources }).datasets[0].measures).toContainEqual({ name: 'target.estimated', approximate: true });
    expect(buildDatasetInputSchema(Sources).safeParse({ measures: ['target.unique'] }).success).toBe(true);
    expect(buildDatasetInputSchema(Sources).safeParse({ measures: ['target.total'] }).success).toBe(false);
  });
  it('reports an explicit unsupported error on the frozen backend path', async () => {
    const backend = createDatasetClient({ backend: createInMemoryBackend({ sources: [], targets: [] }) });
    expect(() => backend.execute(Sources, { measures: ['target.unique'] }, context)).toThrow(/queryBuilder execution path/);
  });
});
