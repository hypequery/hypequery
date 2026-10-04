import {
  dataset, dimension, measure, belongsTo, hasOne, hasMany, eq, gte, like,
  createDatasetClient, type DatasetFilterNames, type DatasetFilterFor,
  type DatasetQueryFor, type MetricQueryFor, type DatasetInstance,
  type DatasetConfig, type MetricFilter, type SemanticFiltersDefinition,
} from '../src/index.js';

const customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    country: dimension.string(), tier: dimension.string({ filterable: false }),
    computed: dimension.string({ sql: 'upper(country)' }), hidden: dimension.string(),
    alias: dimension.string(),
  },
  filters: {
    country: { __type: 'filter_definition', field: 'country', operators: ['eq', 'in'] },
    tier: { __type: 'filter_definition', field: 'tier', operators: ['eq'] },
    computed: { __type: 'filter_definition', field: 'computed' },
    alias: { __type: 'filter_definition', field: 'country' },
  },
});
const orders = dataset('orders', {
  source: 'orders',
  dimensions: { status: dimension.string(), amount: dimension.number() },
  measures: { revenue: measure.sum('amount') },
  filters: {
    state: { __type: 'filter_definition', field: 'status', operators: ['eq', 'in'] },
    amount: { __type: 'filter_definition', field: 'amount', operators: ['gte'] },
  },
  relationships: {
    customer: belongsTo(() => customers, { from: 'customer_id', to: 'id' }),
    profile: hasOne(() => customers, { from: 'customer_id', to: 'id' }),
    items: hasMany(() => customers, { from: 'id', to: 'order_id' }),
  },
});
const revenue = orders.metric('revenue', { measure: 'revenue' });

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Names = Assert<Equal<DatasetFilterNames<typeof orders>,
  'state' | 'amount' | 'customer.country' | 'customer.tier' | 'profile.country' | 'profile.tier'>>;
const names: Names = true;
void names;
const good: DatasetQueryFor<typeof orders> = { filters: [eq('state', 'paid'), gte('amount', 2), eq('customer.tier', 'enterprise')] };
const metricGood: MetricQueryFor<typeof orders, 'revenue'> = good;
void metricGood;
// @ts-expect-error use the allowlist alias, not its backing dimension
const hidden: DatasetFilterFor<typeof orders> = eq('status', 'paid');
// @ts-expect-error restricted operators survive helper inference
const wrongOperator: DatasetFilterFor<typeof orders> = like('state', '%paid%');
// @ts-expect-error local policies are field-specific
const wrongAmountOperator: DatasetFilterFor<typeof orders> = eq('amount', 1);
// @ts-expect-error relationship target operator policy is preserved
const wrongRelatedOperator: DatasetFilterFor<typeof orders> = gte('customer.country', 'US');
// @ts-expect-error target dimensions absent from its allowlist stay hidden
const hiddenRelated: DatasetFilterFor<typeof orders> = eq('customer.hidden', 'x');
// @ts-expect-error aliases to other target dimensions are not queryable over relationships
const aliasRelated: DatasetFilterFor<typeof orders> = eq('customer.alias', 'US');
// @ts-expect-error SQL dimensions cannot be traversed
const sqlRelated: DatasetFilterFor<typeof orders> = eq('customer.computed', 'US');
// @ts-expect-error hasMany is metadata only
const manyRelated: DatasetFilterFor<typeof orders> = eq('items.country', 'US');
// @ts-expect-error multi-hop paths are unsupported
const multiHop: DatasetFilterFor<typeof orders> = eq('customer.profile.country', 'US');
void [hidden, wrongOperator, wrongAmountOperator, wrongRelatedOperator, hiddenRelated, aliasRelated, sqlRelated, manyRelated, multiHop];

const automatic = dataset('automatic', { source: 'automatic', dimensions: {
  status: dimension.string(), secret: dimension.string({ filterable: false }),
  computed: dimension.string({ sql: 'upper(status)' }),
} });
const automaticQuery: DatasetQueryFor<typeof automatic> = { filters: [like('status', 'x'), eq('computed', 'X')] };
void automaticQuery;
// @ts-expect-error filterable false is omitted from generated filters
const secret: DatasetFilterFor<typeof automatic> = eq('secret', 'x');
void secret;
const empty = dataset('empty', { source: 'empty', dimensions: { status: dimension.string() }, filters: {} });
const emptyQuery: DatasetQueryFor<typeof empty> = { filters: [] };
void emptyQuery;
// @ts-expect-error an explicit empty map disables local filters
const emptyFilter: DatasetFilterFor<typeof empty> = eq('status', 'x');
void emptyFilter;
const defaultParent = dataset('parent', { source: 'parent', dimensions: {}, relationships: {
  child: belongsTo(() => automatic, { from: 'id', to: 'id' }),
} });
const defaultRelated: DatasetFilterFor<typeof defaultParent> = eq('child.status', 'x');
void defaultRelated;
// @ts-expect-error generated target allowlists respect filterable false
const defaultRelatedSecret: DatasetFilterFor<typeof defaultParent> = eq('child.secret', 'x');
void defaultRelatedSecret;

// Existing annotated/dynamic contracts remain usable, with intentionally broad policies.
declare const dynamic: DatasetInstance;
const dynamicFilter: DatasetFilterFor<typeof dynamic> = eq('runtime_field', 1);
void dynamicFilter;
declare const config: DatasetConfig;
const configured = dataset('configured', config);
const configuredQuery: DatasetQueryFor<typeof configured> = { filters: [eq('runtime_field', 'x')] };
void configuredQuery;
declare const widenedFilters: SemanticFiltersDefinition;
const widened = dataset('widened', { source: 'widened', dimensions: {}, filters: widenedFilters });
const widenedQuery: DatasetQueryFor<typeof widened> = { filters: [eq('runtime_field', 'x')] };
void widenedQuery;
const legacy: MetricFilter<'state', string> = { field: 'state', operator: 'eq', value: 'x' };
void legacy;

const client = createDatasetClient({ queryBuilder: {} as never });
client.execute(orders, good);
client.execute(revenue, { filters: [eq('profile.country', 'US')] });
// @ts-expect-error dataset execution rejects hidden names
client.execute(orders, { filters: [eq('status', 'paid')] });
// @ts-expect-error metric execution rejects disallowed operators
client.execute(revenue, { filters: [like('state', '%paid%')] });
// Explicit result-row calls retain the shipped dynamic-query escape hatch.
client.execute<Record<string, unknown>>(orders, { filters: [eq('runtime_field', 'x')] });
client.validate(orders, { filters: [eq('runtime_field', 'x')] });

declare const metricHandle: typeof revenue | ReturnType<typeof revenue.by>;
client.execute(metricHandle, { filters: [eq('state', 'paid')] });
// @ts-expect-error a union metric handle preserves its filter allowlist too
client.execute(metricHandle, { filters: [eq('status', 'paid')] });

// Existing partially explicit generic calls may still author filter policies.
dataset<'explicit', { status: ReturnType<typeof dimension.string> }>('explicit', {
  source: 'explicit', dimensions: { status: dimension.string() },
  filters: { state: { __type: 'filter_definition', field: 'status' } },
});
// Generated definitions still expose the optional public metadata properties.
void automatic.filters.status.operators;
void automatic.filters.status.label;
