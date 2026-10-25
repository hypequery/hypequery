import type { AggregationSpec, AnyDatasetInstance, MetricFilter } from '../types.js';
import { resolveFilterField } from '../query-planner.js';
import type { RelationshipBuilderContext } from './relationship-builder-plan.js';
import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';

type DatasetShape = AnyDatasetInstance;

function renderMeasureFilterCondition(
  ds: DatasetShape,
  filter: MetricFilter,
  joinCtx: RelationshipBuilderContext | undefined,
  dialect: DatasetSqlDialectRules,
): string {
  const field = resolveFilterField(ds, filter.field, joinCtx);
  const literal = (value: unknown) => dialect.measureFilterLiteral(value);

  switch (filter.operator) {
    case 'eq':
      return `${field} = ${literal(filter.value)}`;
    case 'neq':
      return `${field} != ${literal(filter.value)}`;
    case 'gt':
      return `${field} > ${literal(filter.value)}`;
    case 'gte':
      return `${field} >= ${literal(filter.value)}`;
    case 'lt':
      return `${field} < ${literal(filter.value)}`;
    case 'lte':
      return `${field} <= ${literal(filter.value)}`;
    case 'like':
      return `${field} LIKE ${literal(filter.value)}`;
    case 'in':
    case 'notIn': {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new Error(`"${filter.operator}" measure filters require a non-empty array.`);
      }

      const values = filter.value.map(literal).join(', ');
      return `${field} ${filter.operator === 'in' ? 'IN' : 'NOT IN'} (${values})`;
    }
    case 'between': {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        throw new Error('"between" measure filters require a two-item array.');
      }

      return `${field} BETWEEN ${literal(filter.value[0])} AND ${literal(filter.value[1])}`;
    }
  }
}

export function applyFilteredAggregationExpression(
  ds: DatasetShape,
  spec: AggregationSpec,
  fieldOrExpr: string,
  joinCtx: RelationshipBuilderContext | undefined,
  dialect: DatasetSqlDialectRules,
): string {
  if (!spec.filters?.length) {
    return fieldOrExpr;
  }

  const combinedCondition = spec.filters
    .map(filter => renderMeasureFilterCondition(ds, filter, joinCtx, dialect))
    .map(condition => `(${condition})`)
    .join(' AND ');

  switch (spec.aggregation) {
    case 'sum':
      return dialect.filteredAggregateInput(combinedCondition, fieldOrExpr, '0');
    // Aggregate functions skip NULLs, so the NULL fallback excludes
    // non-matching rows from percentile/stddev/variance too.
    case 'count':
    case 'countDistinct':
    case 'avg':
    case 'min':
    case 'max':
    case 'percentile':
    case 'stddev':
    case 'variance':
    case 'approxCountDistinct':
      return dialect.filteredAggregateInput(combinedCondition, fieldOrExpr, 'NULL');
    case 'merge':
      // A filtered merge needs -MergeIf; wrapping a state column in if() is a type error.
      throw new Error('Measure filters are not supported on merge aggregations.');
    case 'argMax':
    case 'argMin':
      // NULL handling under argMax/argMin varies across ClickHouse versions.
      throw new Error(`Measure filters are not supported on ${spec.aggregation} aggregations.`);
    default:
      return fieldOrExpr;
  }
}
