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
  | 'state' | 'amount' | 'status'
  | 'customer.country' | 'customer.tier' | 'customer.hidden'
  | 'profile.country' | 'profile.tier' | 'profile.hidden'>>;
const names: Names = true;
void names;
const good: DatasetQueryFor<typeof orders> = { filters: [eq('state', 'paid'), gte('amount', 2), eq('customer.tier', 'enterprise')] };
// Filterable dimensions stay filterable alongside declared filters.
const backing: DatasetQueryFor<typeof orders> = { filters: [eq('status', 'paid'), eq('customer.hidden', 'x')] };
void backing;
const metricGood: MetricQueryFor<typeof orders, 'revenue'> = good;
void metricGood;
// @ts-expect-error a dimension's own filter keeps the operators declared on its field
const hidden: DatasetFilterFor<typeof orders> = like('status', '%paid%');
// @ts-expect-error restricted operators survive helper inference
const wrongOperator: DatasetFilterFor<typeof orders> = like('state', '%paid%');
// @ts-expect-error local policies are field-specific
const wrongAmountOperator: DatasetFilterFor<typeof orders> = eq('amount', 1);
// @ts-expect-error relationship target operator policy is preserved
const wrongRelatedOperator: DatasetFilterFor<typeof orders> = gte('customer.country', 'US');
// @ts-expect-error aliases to other target dimensions are not queryable over relationships
const aliasRelated: DatasetFilterFor<typeof orders> = eq('customer.alias', 'US');
// @ts-expect-error SQL dimensions cannot be traversed
const sqlRelated: DatasetFilterFor<typeof orders> = eq('customer.computed', 'US');
// @ts-expect-error hasMany is metadata only
const manyRelated: DatasetFilterFor<typeof orders> = eq('items.country', 'US');
// @ts-expect-error multi-hop paths are unsupported
const multiHop: DatasetFilterFor<typeof orders> = eq('customer.profile.country', 'US');
void [hidden, wrongOperator, wrongAmountOperator, wrongRelatedOperator, aliasRelated, sqlRelated, manyRelated, multiHop];

const partial = dataset('partial', {
  source: 'partial',
  dimensions: { plan: dimension.string(), region: dimension.string(), secret: dimension.string({ filterable: false }) },
  filters: { plan_filter: { __type: 'filter_definition', field: 'plan', operators: ['eq', 'isNull'] } },
});
type PartialNames = Assert<Equal<DatasetFilterNames<typeof partial>, 'plan_filter' | 'plan' | 'region'>>;
const partialNames: PartialNames = true;
void partialNames;
const planNull: DatasetFilterFor<typeof partial> = { field: 'plan', operator: 'isNull' };
void planNull;
// @ts-expect-error an undeclared dimension's filter admits no null checks
const regionNull: DatasetFilterFor<typeof partial> = { field: 'region', operator: 'isNull' };
// @ts-expect-error declared filters do not expose filterable false dimensions
const partialSecret: DatasetFilterFor<typeof partial> = eq('secret', 'x');
void [regionNull, partialSecret];

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
const emptyQuery: DatasetQueryFor<typeof empty> = { filters: [eq('status', 'x')] };
void emptyQuery;
// @ts-expect-error an explicit empty map still admits no null checks by default
const emptyFilter: DatasetFilterFor<typeof empty> = { field: 'status', operator: 'isNull' };
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
// @ts-expect-error dataset execution rejects unknown names
client.execute(orders, { filters: [eq('runtime_field', 'paid')] });
// @ts-expect-error metric execution rejects disallowed operators
client.execute(revenue, { filters: [like('state', '%paid%')] });
// Explicit result-row calls retain the shipped dynamic-query escape hatch.
client.execute<Record<string, unknown>>(orders, { filters: [eq('runtime_field', 'x')] });
client.validate(orders, { filters: [eq('runtime_field', 'x')] });

declare const metricHandle: typeof revenue | ReturnType<typeof revenue.by>;
client.execute(metricHandle, { filters: [eq('state', 'paid')] });
// @ts-expect-error a union metric handle preserves its filter policies too
client.execute(metricHandle, { filters: [like('status', '%paid%')] });

// Existing partially explicit generic calls may still author filter policies.
dataset<'explicit', { status: ReturnType<typeof dimension.string> }>('explicit', {
  source: 'explicit', dimensions: { status: dimension.string() },
  filters: { state: { __type: 'filter_definition', field: 'status' } },
});
// Generated definitions still expose the optional public metadata properties.
void automatic.filters.status.operators;
void automatic.filters.status.label;
