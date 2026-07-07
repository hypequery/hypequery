import type { AggregationSpec, AnyDatasetInstance, MetricFilter } from '../types.js';
import { resolveFilterField } from '../query-planner.js';
import type { RelationshipBuilderContext } from './relationship-builder-plan.js';

type DatasetShape = AnyDatasetInstance;

function renderMeasureFilterLiteral(value: unknown): string {
  if (value === null) {
    return 'NULL';
  }

  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid non-finite numeric literal in measure filter: ${value}`);
    }
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  throw new Error(`Unsupported literal type in measure filter: ${typeof value}`);
}

function renderMeasureFilterCondition(
  ds: DatasetShape,
  filter: MetricFilter,
  joinCtx?: RelationshipBuilderContext,
): string {
  const field = resolveFilterField(ds, filter.field, joinCtx);

  switch (filter.operator) {
    case 'eq':
      return `${field} = ${renderMeasureFilterLiteral(filter.value)}`;
    case 'neq':
      return `${field} != ${renderMeasureFilterLiteral(filter.value)}`;
    case 'gt':
      return `${field} > ${renderMeasureFilterLiteral(filter.value)}`;
    case 'gte':
      return `${field} >= ${renderMeasureFilterLiteral(filter.value)}`;
    case 'lt':
      return `${field} < ${renderMeasureFilterLiteral(filter.value)}`;
    case 'lte':
      return `${field} <= ${renderMeasureFilterLiteral(filter.value)}`;
    case 'like':
      return `${field} LIKE ${renderMeasureFilterLiteral(filter.value)}`;
    case 'in':
    case 'notIn': {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new Error(`"${filter.operator}" measure filters require a non-empty array.`);
      }

      const values = filter.value.map(renderMeasureFilterLiteral).join(', ');
      return `${field} ${filter.operator === 'in' ? 'IN' : 'NOT IN'} (${values})`;
    }
    case 'between': {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        throw new Error('"between" measure filters require a two-item array.');
      }

      return `${field} BETWEEN ${renderMeasureFilterLiteral(filter.value[0])} AND ${renderMeasureFilterLiteral(filter.value[1])}`;
    }
  }
}

export function applyFilteredAggregationExpression(
  ds: DatasetShape,
  spec: AggregationSpec,
  fieldOrExpr: string,
  joinCtx?: RelationshipBuilderContext,
): string {
  if (!spec.filters?.length) {
    return fieldOrExpr;
  }

  const combinedCondition = spec.filters
    .map(filter => renderMeasureFilterCondition(ds, filter, joinCtx))
    .map(condition => `(${condition})`)
    .join(' AND ');

  switch (spec.aggregation) {
    case 'sum':
      return `if(${combinedCondition}, ${fieldOrExpr}, 0)`;
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
      return `if(${combinedCondition}, ${fieldOrExpr}, NULL)`;
    case 'argMax':
    case 'argMin':
      // NULL handling under argMax/argMin varies across ClickHouse versions.
      throw new Error(`Measure filters are not supported on ${spec.aggregation} aggregations.`);
    default:
      return fieldOrExpr;
  }
}
