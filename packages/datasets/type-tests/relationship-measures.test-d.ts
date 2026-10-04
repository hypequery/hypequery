import { dataset, dimension, measure, add, belongsTo, hasOne, hasMany, createDatasetClient, type DatasetQueryFor } from '../src/index.js';
const targets = dataset('targets', {
  source: 'targets', timeKey: 'time', dimensions: { id: dimension.number(), computed: dimension.number({ sql: 'id + 1' }) },
  measures: {
    unique: measure.countDistinct('id'), estimated: measure.approxCountDistinct('id'),
    min: measure.min('id'), max: measure.max('id'), arg: measure.argMax('id', 'time'),
    sum: measure.sum('id'), count: measure.count('id'), avg: measure.avg('id'),
    raw: measure.min('id', { sql: 'id + 1' }), computed: measure.min('computed'),
    derived: measure.derived({ uses: { sum: 'sum' }, formula: ({ sum }) => add(sum, sum) }),
    window: measure.trailing('sum', { amount: 7, unit: 'day' }), shift: measure.shift('sum', { amount: 1, unit: 'day' }),
  },
});
const sources = dataset('sources', {
  source: 'sources', dimensions: { id: dimension.number() }, measures: { count: measure.count('id') },
  relationships: {
    target: belongsTo(() => targets, { from: 'target_id', to: 'id' }),
    profile: hasOne(() => targets, { from: 'id', to: 'id' }),
    many: hasMany(() => targets, { from: 'id', to: 'id' }),
  },
});
const query: DatasetQueryFor<typeof sources> = {
  measures: ['count', 'target.unique', 'target.estimated', 'target.min', 'target.max', 'target.arg', 'profile.sum', 'profile.count', 'profile.avg'],
  orderBy: [{ field: 'target.unique', direction: 'desc' }],
};
void query;
// @ts-expect-error belongsTo sum repeats the target population
const sum: DatasetQueryFor<typeof sources> = { measures: ['target.sum'] };
// @ts-expect-error count is not duplicate insensitive
const count: DatasetQueryFor<typeof sources> = { measures: ['target.count'] };
// @ts-expect-error hasMany fans out aggregates
const many: DatasetQueryFor<typeof sources> = { measures: ['many.unique'] };
// @ts-expect-error multihop is unsupported
const multi: DatasetQueryFor<typeof sources> = { measures: ['target.other.unique'] };
// @ts-expect-error related derived measures are unsupported
const derived: DatasetQueryFor<typeof sources> = { measures: ['target.derived'] };
// @ts-expect-error related time measures are unsupported
const window: DatasetQueryFor<typeof sources> = { measures: ['profile.window'] };
// @ts-expect-error related shift measures are unsupported
const shift: DatasetQueryFor<typeof sources> = { measures: ['profile.shift'] };
// @ts-expect-error SQL escape hatches are not safe under joins
const raw: DatasetQueryFor<typeof sources> = { measures: ['profile.raw'] };
// @ts-expect-error SQL-backed target dimensions are not safe aggregate inputs
const computed: DatasetQueryFor<typeof sources> = { measures: ['target.computed'] };
void [sum, count, many, multi, derived, window, shift, raw, computed];
const client = createDatasetClient({ queryBuilder: {} as never });
async function projections() {
  const result = await client.execute(sources, { measures: ['target.unique'] });
  const value: string | null | undefined = result.data[0]?.['target.unique'];
  void value;
  // @ts-expect-error unselected measures are absent
  result.data[0]?.count;
  // @ts-expect-error implicit execution cannot select unsafe related aggregates
  await client.execute(sources, { measures: ['target.sum'] });
}
void projections;
