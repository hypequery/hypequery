import type { FilterOperator } from '../../types/index.js';
import type { PredicateBuilder, PredicateExpression } from './predicate-builder.js';
import { validateTupleFilterValue } from './tuple-filter-validation.js';

export interface FilterExpressionApplication<TExpression> {
  kind: 'expression';
  expression: TExpression;
}

export interface FilterConditionApplication {
  kind: 'condition';
  column: string | string[];
  validationTarget: string | string[];
  operator: FilterOperator;
  value: unknown;
}

export function normalizeFilterApplication<TExpression>(
  clause: 'where' | 'prewhere',
  conjunction: 'AND' | 'OR',
  columnOrColumns: string | string[] | ((expr: PredicateBuilder<any>) => PredicateExpression),
  operator: FilterOperator | undefined,
  value: unknown,
  buildExpression: (builder: (expr: PredicateBuilder<any>) => PredicateExpression) => TExpression
): FilterExpressionApplication<TExpression> | FilterConditionApplication {
  if (typeof columnOrColumns === 'function') {
    return {
      kind: 'expression',
      expression: buildExpression(columnOrColumns),
    };
  }

  if (operator === undefined) {
    throw new Error(`Operator is required when specifying a column for ${conjunction === 'AND' ? clause : `or${clause[0]!.toUpperCase()}${clause.slice(1)}`}()`);
  }

  if (Array.isArray(columnOrColumns) && (operator === 'inTuple' || operator === 'globalInTuple')) {
    const columns = columnOrColumns.map(String);
    validateTupleFilterValue(operator, value, columns.length);
    return {
      kind: 'condition',
      column: columns,
      validationTarget: columns,
      operator,
      value,
    };
  }

  validateTupleFilterValue(operator, value, 1);

  const column = Array.isArray(columnOrColumns) ? String(columnOrColumns[0]) : String(columnOrColumns);
  return {
    kind: 'condition',
    column,
    validationTarget: Array.isArray(columnOrColumns) ? columnOrColumns.map(String) : column,
    operator,
    value,
  };
}
