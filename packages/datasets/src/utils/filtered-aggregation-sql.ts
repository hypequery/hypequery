import type { AggregationSpec, AnyDatasetInstance, MetricFilter } from '../types.js';
import { resolveDimensionExpression, resolveFilterField } from '../query-planner.js';

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
): string {
  const field = resolveFilterField(ds, filter.field);

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
): string {
  if (!spec.filters?.length) {
    return fieldOrExpr;
  }

  const combinedCondition = spec.filters
    .map(filter => renderMeasureFilterCondition(ds, filter))
    .map(condition => `(${condition})`)
    .join(' AND ');

  switch (spec.aggregation) {
    case 'sum':
      return `if(${combinedCondition}, ${fieldOrExpr}, 0)`;
    case 'count':
    case 'countDistinct':
    case 'avg':
    case 'min':
    case 'max':
      return `if(${combinedCondition}, ${fieldOrExpr}, NULL)`;
    default:
      return fieldOrExpr;
  }
}
