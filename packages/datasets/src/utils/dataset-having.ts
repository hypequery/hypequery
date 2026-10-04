import { SEMANTIC_HAVING_OPERATORS } from '../constants.js';
import type { AnyDatasetInstance, DatasetHavingCondition, DatasetQuery } from '../types.js';
import { selectedTimeMeasures } from './time-query-measures.js';

const HAVING_OPERATORS: ReadonlySet<string> = new Set(SEMANTIC_HAVING_OPERATORS);

const COMPARISONS: Readonly<Record<string, string>> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function conditionValueError(condition: DatasetHavingCondition): string | undefined {
  const { measure, operator, value } = condition;
  if (operator === 'between') {
    return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber)
      ? undefined
      : `Having "between" on "${measure}" expects a two-item array of finite numbers.`;
  }
  if (operator === 'in' || operator === 'notIn') {
    return Array.isArray(value) && value.length > 0 && value.every(isFiniteNumber)
      ? undefined
      : `Having "${operator}" on "${measure}" expects a non-empty array of finite numbers.`;
  }
  return isFiniteNumber(value)
    ? undefined
    : `Having "${operator}" on "${measure}" expects a finite number.`;
}

/**
 * Validates `having` conditions against the query they belong to.
 *
 * A condition may only reference a measure the query selects: that is the
 * value the condition reads, and it keeps every rendered reference an output
 * alias rather than an expression taken from input.
 */
export function datasetHavingErrors(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  selectedMeasures: readonly string[],
): string[] {
  if (query.having === undefined) return [];
  if (!Array.isArray(query.having)) return ['Having must be an array of conditions.'];
  if (query.having.length === 0) return [];

  const errors: string[] = [];
  if (selectedTimeMeasures(ds, query).size > 0) {
    errors.push('Having is not supported on queries that select window or shift measures.');
  }
  const maxFilters = ds.limits?.maxFilters;
  if (maxFilters && query.having.length > maxFilters) {
    errors.push(`Too many having conditions: ${query.having.length} (max ${maxFilters})`);
  }

  const selected = new Set(selectedMeasures);
  for (const condition of query.having as unknown[]) {
    if (typeof condition !== 'object' || condition === null) {
      errors.push('Each having condition must be an object with measure, operator and value.');
      continue;
    }
    const { measure, operator } = condition as Partial<DatasetHavingCondition>;
    if (typeof measure !== 'string' || !selected.has(measure)) {
      errors.push(
        `Having measure "${String(measure)}" must be one of the selected measures: ${[...selected].join(', ')}`,
      );
      continue;
    }
    if (typeof operator !== 'string' || !HAVING_OPERATORS.has(operator)) {
      errors.push(
        `Unsupported having operator "${String(operator)}" on "${measure}". ` +
        `Supported: ${SEMANTIC_HAVING_OPERATORS.join(', ')}`,
      );
      continue;
    }
    const valueError = conditionValueError(condition as DatasetHavingCondition);
    if (valueError) errors.push(valueError);
  }
  return errors;
}

/**
 * Renders validated `having` conditions as one parameterized predicate.
 *
 * `measureSql` maps a selected measure to the expression that reads its
 * aggregated value in the outer query. Values are only ever bound as `?`
 * parameters, appended in placeholder order.
 */
export function datasetHavingSql(
  conditions: readonly DatasetHavingCondition[],
  measureSql: (measure: string) => string,
): { sql: string; parameters: unknown[] } {
  const parameters: unknown[] = [];
  const predicates = conditions.map((condition) => {
    const column = measureSql(condition.measure);
    if (condition.operator === 'between') {
      parameters.push(condition.value[0], condition.value[1]);
      return `${column} BETWEEN ? AND ?`;
    }
    if (condition.operator === 'in' || condition.operator === 'notIn') {
      parameters.push(...condition.value);
      const placeholders = condition.value.map(() => '?').join(', ');
      return `${column} ${condition.operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`;
    }
    const comparison = COMPARISONS[condition.operator];
    if (!comparison) throw new Error(`Unsupported having operator "${String(condition.operator)}".`);
    parameters.push(condition.value);
    return `${column} ${comparison} ?`;
  });
  return { sql: predicates.join(' AND '), parameters };
}
