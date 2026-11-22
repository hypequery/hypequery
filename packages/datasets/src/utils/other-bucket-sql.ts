/**
 * RFC 0026 `other`: the top-N ranking statement, and the dataset view whose
 * selected dimension reads `if(value IN top-N, value, label)`.
 *
 * Every row is regrouped from source, so every measure in the remainder row
 * is exact, `countDistinct` included. The ranking runs over the same filters,
 * segments and tenancy as the query, over its whole range rather than per
 * period, and never counts NULL as a top value.
 */

import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import type { AnyDatasetInstance } from '../types.js';
import { buildDatasetQueryBuilder } from './build-dataset-query-builder.js';
import { buildDerivedDatasetSql } from './dataset-derived-query.js';
import { withDimensionSelectionRewrite } from './dimension-selection-overrides.js';
import { OTHER_TOP_CTE } from './calculation-stage-sql.js';
import type { PlannedOther, QueryCalculationPlan } from './query-calculation-plan.js';
import type { PlannedStatement } from './statement-parameters.js';
import { UnsupportedQueryCalculationError } from './query-calculation-errors.js';

/** `limitBy`, `other` and joined share denominators rely on ClickHouse SQL. */
export function assertStageSupported(plan: QueryCalculationPlan, dialect: DatasetSqlDialectRules): void {
  if (dialect.name === 'clickhouse') return;
  const reasons = [
    ...(plan.limitBy === undefined ? [] : ['"limitBy"']),
    ...(plan.other === undefined ? [] : ['"other"']),
    ...(plan.shares.some(share => share.denominator !== undefined) ? ['a share of a non-additive measure'] : []),
  ];
  if (reasons.length > 0) {
    throw new UnsupportedQueryCalculationError(
      [`${reasons.join(', ')} ${reasons.length === 1 ? 'is' : 'are'} not supported on the "${dialect.name}" dialect.`],
    );
  }
}

export function withOtherBucket(
  ds: AnyDatasetInstance,
  other: PlannedOther,
  dialect: DatasetSqlDialectRules,
): AnyDatasetInstance {
  const top = `SELECT ${dialect.quoteIdentifier(other.dimension)} FROM ${dialect.quoteIdentifier(OTHER_TOP_CTE)}`;
  const label = dialect.measureFilterLiteral(other.label);
  return withDimensionSelectionRewrite(ds, other.dimension, expression => `if(${expression} IN (${top}), ${expression}, ${label})`);
}

export function otherRankingSql(
  ds: AnyDatasetInstance,
  other: PlannedOther,
  options: DatasetQueryExecutionOptions,
  dialect: DatasetSqlDialectRules,
): PlannedStatement {
  const ranked = buildDerivedDatasetSql(ds, other.ranking, options, buildDatasetQueryBuilder);
  const quote = dialect.quoteIdentifier;
  const dimension = quote(other.dimension);
  // Ties break on the value itself, so the list is deterministic.
  return {
    text: `SELECT ${dimension} FROM (${ranked.text}) AS ${quote('_hq_other_ranked')} WHERE ${dimension} IS NOT NULL`
      + ` ORDER BY ${quote(other.measure)} DESC, ${dimension} ASC LIMIT ${other.n}`,
    parameters: ranked.parameters,
  };
}
