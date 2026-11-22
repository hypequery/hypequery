import type { DatasetFilterNode, MetricFilter } from '../types.js';
import { isFilterGroup } from './filter-tree.js';
import type { QueryTimePredicate } from './query-timezone.js';
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
    default:
      // `inDateRange` applies only to the time axis, which conditions can't use.
      throw new Error(`Operator "${filter.operator}" can't be used in an event condition.`);
  }
}

/**
 * AND-combined conditions as a non-null 0/1 flag: a NULL comparison is a
 * non-match, so array and aggregate functions never see a Nullable flag.
 *
 * `predicatesFor` turns one condition into the predicates that test it, the
 * way a caller filter on the same field is applied: a timestamp instant is
 * compared in UTC, and a mixed range splits into one predicate per kind.
 */
export function eventConditionFlagSql(
  conditions: readonly DatasetFilterNode[],
  predicatesFor: (condition: MetricFilter) => readonly QueryTimePredicate[],
  statement: StatementParameters,
): string {
  const leaf = (condition: MetricFilter) => predicatesFor(condition).map(predicate => {
    const filter = { field: condition.field, operator: predicate.operator, value: predicate.value } as MetricFilter;
    return `(${eventConditionSql(predicate.expression, filter, statement)})`;
  }).join(' AND ');
  // RFC 0029 groups render as written. SQL three-valued logic makes a NULL
  // field fail a comparison and its negation alike, and the outer ifNull
  // reads what is left NULL as "no match".
  const node = (item: DatasetFilterNode): string => {
    if (!isFilterGroup(item)) return `(${leaf(item)})`;
    const group = item as { and?: readonly DatasetFilterNode[]; or?: readonly DatasetFilterNode[]; not?: DatasetFilterNode };
    if (group.not !== undefined) return `(NOT ${node(group.not)})`;
    const items = (group.and ?? group.or ?? []).map(node);
    return `(${items.join(group.and ? ' AND ' : ' OR ')})`;
  };
  return `toUInt8(ifNull(${conditions.map(node).join(' AND ')}, 0))`;
}
