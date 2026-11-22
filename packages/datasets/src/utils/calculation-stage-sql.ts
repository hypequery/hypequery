/**
 * The RFC 0026 outer stage over a planned statement.
 *
 * 1. Window layer: `rank` and `share` over the grouped rows, before anything
 *    filters them, so a rank or share is of every group the filters select.
 *    A non-additive share joins its denominator, re-aggregated from source
 *    rows at the coarser grain (NULL keys match).
 * 2. Output layer: names every calculation output as the caller wrote it,
 *    then `having`, ordering, `limitBy` and pagination.
 * 3. `other`'s top-N list, as a CTE every inner statement can read.
 */

import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { DatasetQuery } from '../types.js';
import { datasetHavingSql } from './dataset-having.js';
import { semanticOrderDirection } from './semantic-query-syntax.js';
import type { PlannedStatement, RenderedStatement } from './statement-parameters.js';
import type { QueryCalculationPlan } from './query-calculation-plan.js';

/** The CTE `other` reads its top-N values from. */
export const OTHER_TOP_CTE = '_hq_other_top';
const INNER = '_hq_calc';
const WINDOWED = '_hq_calc_windowed';
const TOTAL = '_hq_total';

export interface CalculationStageStatements {
  /** Each non-additive share's denominator statement, by the share's internal name. */
  readonly denominators: ReadonlyMap<string, RenderedStatement>;
  /** `other`'s top-N statement. */
  readonly otherTop?: RenderedStatement;
}

function windowLayer(
  plan: QueryCalculationPlan,
  inner: PlannedStatement,
  dialect: DatasetSqlDialectRules,
  statements: CalculationStageStatements,
): string {
  if (plan.ranks.length === 0 && plan.shares.length === 0) return inner.text;
  const quote = dialect.quoteIdentifier;
  const column = (name: string) => `${quote(INNER)}.${quote(name)}`;
  const partition = (names: readonly string[]) => (
    names.length === 0 ? '' : `PARTITION BY ${names.map(column).join(', ')} `
  );
  const nullIfZero = (sql: string) => dialect.formulaFunction('nullIfZero', [sql]);
  const projections = [`${quote(INNER)}.*`];
  const joins: string[] = [];
  for (const rank of plan.ranks) {
    const order = `${column(rank.column)} ${rank.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
    projections.push(`rank() OVER (${partition(rank.within)}ORDER BY ${order}) AS ${quote(rank.internal)}`);
  }
  for (const share of plan.shares) {
    const denominator = statements.denominators.get(share.internal);
    if (denominator === undefined) {
      projections.push(`${column(share.column)} / ${nullIfZero(`sum(${column(share.column)}) OVER (${partition(share.of).trimEnd()})`)} AS ${quote(share.internal)}`);
      continue;
    }
    const alias = quote(`_hq_share_${share.internal}`);
    const marker = inner.parameters.embed(denominator);
    const keys = share.of.map(name => quote(name));
    const select = `SELECT ${[...keys, `${quote(share.column)} AS ${quote(TOTAL)}`].join(', ')} FROM (${marker}) AS ${quote('_hq_share_source')}`;
    joins.push(share.of.length === 0
      ? ` CROSS JOIN (${select}) AS ${alias}`
      : ` LEFT JOIN (${select}) AS ${alias} ON ${share.of.map(name => (
        `isNotDistinctFrom(${column(name)}, ${alias}.${quote(name)})`
      )).join(' AND ')}`);
    projections.push(`${column(share.column)} / ${nullIfZero(`${alias}.${quote(TOTAL)}`)} AS ${quote(share.internal)}`);
  }
  return `SELECT ${projections.join(', ')} FROM (${inner.text}) AS ${quote(INNER)}${joins.join('')}`;
}

export function buildCalculationStageSql(
  query: DatasetQuery,
  plan: QueryCalculationPlan,
  inner: PlannedStatement,
  dialect: DatasetSqlDialectRules,
  executionLimit: number | undefined,
  statements: CalculationStageStatements = { denominators: new Map() },
): PlannedStatement {
  const quote = dialect.quoteIdentifier;
  const internal = new Map(plan.outputs.map(output => [output.name, output.internal]));
  const column = (name: string) => quote(internal.get(name) ?? name);

  const projections = [
    ...(query.by ? [quote('period')] : []),
    ...(query.dimensions ?? []).map(dimension => quote(dimension)),
    ...plan.selectedMeasures.map(measure => quote(measure)),
    ...plan.outputs.map(output => `${quote(output.internal)} AS ${quote(output.name)}`),
  ];
  const source = windowLayer(plan, inner, dialect, statements);
  const from = source === inner.text ? INNER : WINDOWED;
  let text = `SELECT ${projections.join(', ')} FROM (${source}) AS ${quote(from)}`;
  // Conditions read the inner columns rather than output aliases, so they
  // stay valid on dialects that do not resolve aliases in WHERE.
  if (plan.having.length > 0) {
    text += ` WHERE ${datasetHavingSql([...plan.having], column, inner.parameters)}`;
  }
  const order = plan.orderBy.length > 0
    ? plan.orderBy
    : query.by ? [{ field: 'period', direction: 'asc' as const }] : [];
  if (order.length > 0) {
    text += ` ORDER BY ${order.map(item => dialect.orderTerm(column(item.field), semanticOrderDirection(item.direction))).join(', ')}`;
  }
  if (plan.limitBy !== undefined) {
    text += ` LIMIT ${plan.limitBy.n} BY ${plan.limitBy.by.map(name => quote(name)).join(', ')}`;
  }
  text += dialect.paginate(executionLimit ?? plan.limit, plan.offset);
  if (statements.otherTop !== undefined) {
    text = `WITH ${quote(OTHER_TOP_CTE)} AS (${inner.parameters.embed(statements.otherTop)}) ${text}`;
  }
  return { text, parameters: inner.parameters };
}
