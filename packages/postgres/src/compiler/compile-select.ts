import type { JoinNode, OrderNode, PlaceholderWriter, PostgresSelectNode } from '../types.js';
import { splitQuotedAlias } from '../utils/selection-alias.js';
import { compileCondition } from './conditions.js';

/**
 * Compile a select node. Clauses render in SQL order, so `placeholder` is
 * called once per bound value in the order the values appear in the text.
 */
export function compileSelect(node: PostgresSelectNode, placeholder: PlaceholderWriter): string {
  const select = node.select.length ? node.select.map(item => item.sql).join(', ') : '*';
  let sql = `SELECT ${select} FROM ${node.from}`;
  for (const join of node.joins) sql += ` ${compileJoin(join, placeholder)}`;
  if (node.where.length) {
    sql += ` WHERE ${node.where.map(condition => compileCondition(condition, placeholder)).join(' AND ')}`;
  }
  if (node.groupBy.length) sql += ` GROUP BY ${groupByExpressions(node).join(', ')}`;
  if (node.orderBy.length) sql += ` ORDER BY ${node.orderBy.map(orderTerm).join(', ')}`;
  if (node.limit !== undefined) sql += ` LIMIT ${node.limit}`;
  if (node.offset !== undefined) sql += ` OFFSET ${node.offset}`;
  return sql;
}

function compileJoin(join: JoinNode, placeholder: PlaceholderWriter): string {
  const predicates = [
    ...join.keys.map(([left, right]) => `${left} = ${right}`),
    ...join.conditions.map(condition => compileCondition(condition, placeholder)),
  ].join(' AND ');
  if (join.strategy === 'left') {
    return `LEFT JOIN ${join.source}${join.alias ? ` AS ${join.alias}` : ''} ON ${predicates}`;
  }
  // ClickHouse `LEFT ANY JOIN`: at most one matching right row per left row,
  // so a duplicated target key cannot fan out aggregates. The lateral
  // subquery re-uses the join alias, so `alias.column` references in the
  // keys and conditions resolve to the inner row; it is indexed by the key.
  const alias = join.alias ?? join.source;
  return `LEFT JOIN LATERAL (SELECT * FROM ${join.source} AS ${alias} WHERE ${predicates} LIMIT 1) AS ${alias} ON TRUE`;
}

/**
 * Postgres resolves a GROUP BY name to an input column before an output
 * alias, so grouping by `"region"` would silently group by a source column
 * named `region` when `upper(region_code) AS "region"` was meant. Group by
 * the aliased expression instead.
 */
function groupByExpressions(node: PostgresSelectNode): string[] {
  const aliased = new Map<string, string>();
  for (const item of node.select) {
    const split = splitQuotedAlias(item.sql);
    if (split && !item.isAggregate) aliased.set(split.alias, split.expression);
  }
  return node.groupBy.map(expression => aliased.get(expression.trim()) ?? expression);
}

/** ClickHouse orders NULLs last in both directions; Postgres puts them first under DESC. */
export function orderTerm(order: Pick<OrderNode, 'expression' | 'direction'>): string {
  if (order.direction === 'DESC') return `${order.expression} DESC NULLS LAST`;
  return order.direction ? `${order.expression} ${order.direction}` : order.expression;
}
