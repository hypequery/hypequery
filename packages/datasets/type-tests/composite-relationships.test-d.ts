import { belongsTo, hasOne, hasMany, dataset, dimension, measure, createDatasetClient, type RelationshipJoin } from '../src/index.js';
const target = dataset('targets', { source: 'targets', dimensions: { name: dimension.string() }, measures: { unique: measure.countDistinct('id') } });
const keys = [{ from: 'customer_id', to: 'id' }, { from: 'region_code', to: 'region' }] as const;
const source = dataset('sources', { source: 'sources', dimensions: { status: dimension.string() }, relationships: { customer: belongsTo(() => target, { keys }), profile: hasOne(() => target, { keys }), many: hasMany(() => target, { keys }) } });
const single: RelationshipJoin = { from: 'customer_id', to: 'id' };
void single;
// @ts-expect-error composite keys must be non-empty
belongsTo(() => target, { keys: [] });
// @ts-expect-error syntax is exclusive
belongsTo(() => target, { from: 'id', to: 'id', keys });
// @ts-expect-error every pair needs both columns
belongsTo(() => target, { keys: [{ from: 'id' }] });
// @ts-expect-error key options are immutable
source.relationships.customer.keys![0].from = 'changed';
const client = createDatasetClient({ queryBuilder: {} as never });
async function projection() {
  const result = await client.execute(source, { dimensions: ['customer.name'], measures: ['customer.unique'] });
  const name: string | undefined = result.data[0]?.['customer.name'];
  const unique: string | null | undefined = result.data[0]?.['customer.unique'];
  void [name, unique];
  // @ts-expect-error composite keys do not make hasMany queryable
  await client.execute(source, { dimensions: ['many.name'] });
}
void projection;
