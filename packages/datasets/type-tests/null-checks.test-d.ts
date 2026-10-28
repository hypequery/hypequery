import {
  dataset, dimension, measure, isNull, isNotNull, eq, filter,
  createDatasetClient, SEMANTIC_NULL_CHECK_OPERATORS,
  type DatasetFilterFor, type DatasetHavingOperator, type MetricFilter, type MetricFilterOperator,
  type MetricNullCheckOperator, type MetricValueFilterOperator, type SegmentDefinition,
} from '../src/index.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// RFC 0023: the null checks are comparison operators that take no value.
type _operators = Assert<Equal<MetricFilterOperator, MetricValueFilterOperator | MetricNullCheckOperator>>;
type _nullChecks = Assert<Equal<(typeof SEMANTIC_NULL_CHECK_OPERATORS)[number], 'isNull' | 'isNotNull'>>;
type _having = Assert<Equal<Extract<DatasetHavingOperator, MetricNullCheckOperator>, never>>;
type _helper = Assert<Equal<ReturnType<typeof isNotNull<'churnedAt'>>, MetricFilter<'churnedAt', never, 'isNotNull'>>>;

const literal: MetricFilter = { field: 'churnedAt', operator: 'isNotNull' };
const helpers: MetricFilter[] = [isNull('churnedAt'), isNotNull('churnedAt'), filter.isNull('plan'), eq('plan', 'pro')];
// @ts-expect-error a null check takes no value
const withValue: MetricFilter = { field: 'churnedAt', operator: 'isNotNull', value: '1971-01-01' };
// @ts-expect-error a value operator still requires one
const withoutValue: MetricFilter = { field: 'plan', operator: 'eq' };
void literal; void helpers; void withValue; void withoutValue;

const customers = dataset('customers', {
  source: 'customers',
  dimensions: { plan: dimension.string(), churnedAt: dimension.timestamp({ column: 'churned_at' }) },
  measures: {
    customers: measure.count('id'),
    churned: measure.count('id', { filters: [isNotNull('churnedAt')] }),
  },
  filters: {
    plan: { __type: 'filter_definition', field: 'plan' },
    churnedAt: { __type: 'filter_definition', field: 'churnedAt', operators: ['gte', 'isNull', 'isNotNull'] },
  },
});

// Opted in through the filter's operator list.
const optedIn: DatasetFilterFor<typeof customers> = isNotNull('churnedAt');
// @ts-expect-error a filter without an operator list admits only value operators
const notOptedIn: DatasetFilterFor<typeof customers> = isNull('plan');
void optedIn; void notOptedIn;

const segment: SegmentDefinition = { filters: [isNotNull('churnedAt')] };
void segment;

const client = createDatasetClient({ queryBuilder: {} as never });
client.execute(customers, { measures: ['customers'], filters: [isNotNull('churnedAt'), { field: 'churnedAt', operator: 'isNull' }] });
// @ts-expect-error typed execution keeps the opt-in policy
client.execute(customers, { measures: ['customers'], filters: [isNull('plan')] });
