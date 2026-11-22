import type { MetricFilter } from '../types.js';
import type { StatementParameters } from './statement-parameters.js';

/**
 * One RFC 0027 condition as a SQL boolean over an already-projected column.
 * Every caller value is bound as a parameter, never inlined.
 */
export function eventConditionSql(column: string, filter: MetricFilter, statement: StatementParameters): string {
  const bind = (value: unknown) => statement.bind(value);
  switch (filter.operator) {
    case 'eq': return `${column} = ${bind(filter.value)}`;
    case 'neq': return `${column} != ${bind(filter.value)}`;
    case 'gt': return `${column} > ${bind(filter.value)}`;
    case 'gte': return `${column} >= ${bind(filter.value)}`;
    case 'lt': return `${column} < ${bind(filter.value)}`;
    case 'lte': return `${column} <= ${bind(filter.value)}`;
    case 'like': return `${column} LIKE ${bind(filter.value)}`;
    case 'isNull': return `${column} IS NULL`;
    case 'isNotNull': return `${column} IS NOT NULL`;
    case 'in':
    case 'notIn': {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new Error(`"${filter.operator}" conditions require a non-empty array.`);
      }
      const values = filter.value.map(bind).join(', ');
      return `${column} ${filter.operator === 'in' ? 'IN' : 'NOT IN'} (${values})`;
    }
    case 'between': {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        throw new Error('"between" conditions require a two-item array.');
      }
      return `${column} BETWEEN ${bind(filter.value[0])} AND ${bind(filter.value[1])}`;
    }
  }
}

/**
 * AND-combined conditions as a non-null 0/1 flag: a NULL comparison is a
 * non-match, so array and aggregate functions never see a Nullable flag.
 */
export function eventConditionFlagSql(
  conditions: readonly MetricFilter[],
  columnFor: (field: string) => string,
  statement: StatementParameters,
): string {
  const parts = conditions.map(condition => `(${eventConditionSql(columnFor(condition.field), condition, statement)})`);
  return `toUInt8(ifNull(${parts.join(' AND ')}, 0))`;
}
