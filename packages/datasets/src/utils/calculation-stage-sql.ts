/**
 * The RFC 0026 outer stage: names calculation outputs as the caller wrote
 * them, then applies `having`, ordering and pagination over the planned
 * statement, after every calculation has been computed.
 */

import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { DatasetQuery } from '../types.js';
import { datasetHavingSql } from './dataset-having.js';
import { semanticOrderDirection } from './semantic-query-syntax.js';
import type { PlannedStatement } from './statement-parameters.js';
import type { QueryCalculationPlan } from './query-calculation-plan.js';

export function buildCalculationStageSql(
  query: DatasetQuery,
  plan: QueryCalculationPlan,
  inner: PlannedStatement,
  dialect: DatasetSqlDialectRules,
  executionLimit: number | undefined,
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
  let text = `SELECT ${projections.join(', ')} FROM (${inner.text}) AS ${quote('_hq_calc')}`;
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
  text += dialect.paginate(executionLimit ?? plan.limit, plan.offset);
  return { text, parameters: inner.parameters };
}
