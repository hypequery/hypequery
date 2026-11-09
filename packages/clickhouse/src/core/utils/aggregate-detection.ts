/**
 * Detects selections that must not be inferred as GROUP BY keys: expressions
 * that call an aggregate function anywhere (`round(avg(x), 2)`,
 * `sum(a) / count()`) and window functions (`rank() OVER (...)`). ClickHouse
 * rejects either one in GROUP BY ("Aggregate function ... is found in GROUP BY").
 */

const AGGREGATE_NAMES = [
  'count', 'sum', 'avg', 'min', 'max', 'any', 'anyLast', 'anyHeavy',
  'argMax', 'argMin', 'uniq', 'uniqExact', 'uniqCombined', 'uniqCombined64',
  'uniqHLL12', 'uniqTheta', 'quantile', 'quantiles', 'quantileExact',
  'quantileTiming', 'quantileTDigest', 'median', 'groupArray', 'groupUniqArray',
  'groupBitmap', 'topK', 'stddevPop', 'stddevSamp', 'varPop', 'varSamp',
  'covarPop', 'covarSamp', 'corr', 'sumMap', 'avgWeighted', 'entropy',
].join('|');

// An aggregate name with optional combinators (sumIf, uniqMerge, countState,
// avgOrNull, ...), followed by its argument list. Any *Merge or *State call is
// also an aggregate.
const AGGREGATE_CALL = new RegExp(
  `(?<![A-Za-z0-9_.])(?:(?:${AGGREGATE_NAMES})(?:If|Array|Distinct|OrNull|OrDefault|ForEach|Resample|Merge|State)*|[A-Za-z][A-Za-z0-9_]*(?:Merge|State))\\s*\\(`,
  'i',
);

const WINDOW_CLAUSE = /\)\s*OVER\s*(?:\(|[A-Za-z_])/i;

/** Removes quoted string literals and quoted identifiers, keeping the rest. */
function stripQuoted(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'|`[^`]*`|"[^"]*"/g, "''");
}

/** True when the expression aggregates rows or is a window function. */
export function isAggregateOrWindowExpression(expression: string): boolean {
  const sql = stripQuoted(expression);
  return AGGREGATE_CALL.test(sql) || WINDOW_CLAUSE.test(sql);
}
