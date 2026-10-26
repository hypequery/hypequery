import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  type ExecutionContext,
  type QueryBuilderFactoryLike,
  type SemanticExecutionRuntime,
} from '../src/index.js';

declare const queryBuilder: QueryBuilderFactoryLike;
const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  dimensions: { region: dimension.string() },
  filters: { region: { __type: 'filter_definition', field: 'region' } },
  measures: { revenue: measure.sum('amount') },
});
const client = createDatasetClient({ queryBuilder });

// Enforced constraints are RFC 0019 comparisons resolved from trusted context.
const runtime: SemanticExecutionRuntime = {
  tenant: { id: 't1' },
  constraints: [
    { field: 'region', operator: 'eq', value: 'emea' },
    { field: 'region', operator: 'in', value: ['emea', 'apac'] },
  ],
};
const context: ExecutionContext = { runtime };
client.execute(Orders, { measures: ['revenue'] }, context);

// @ts-expect-error constraints are a list, not a single comparison.
const single: SemanticExecutionRuntime = { constraints: { field: 'region', operator: 'eq', value: 'emea' } };
// @ts-expect-error an operator outside the filter vocabulary is refused.
const badOperator: SemanticExecutionRuntime = { constraints: [{ field: 'region', operator: 'matches', value: 'e%' }] };
// @ts-expect-error a comparison needs a field.
const noField: SemanticExecutionRuntime = { constraints: [{ operator: 'eq', value: 'emea' }] };
void single;
void badOperator;
void noField;
