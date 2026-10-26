import { semanticOrderDirection } from './utils/semantic-query-syntax.js';
import { canonicalTimezone, queryTimeSql } from './utils/query-timezone.js';
import { zonedDatasetSqlDialect } from './utils/dataset-sql-dialect.js';
import { assertNoRawSqlUnderJoins } from './utils/sql-under-joins.js';
import type {
  AggregationSpec,
  AnyDatasetInstance,
  ExecutionContext,
  MeasureDefinition,
  MetricOrderBy,
  TimeGrain,
} from "./types.js";
import type { QueryBuilderLike } from "./query-builder-protocol.js";
import { isSupportedTimeGrain } from "./constants.js";
import { applyFilteredAggregationExpression } from './utils/filtered-aggregation-sql.js';
import { getRuntimeTenantPredicate } from './utils/tenant-runtime.js';
import type { DatasetSqlDialectRules } from './dataset-sql-dialect.js';
import { isQualifiedField } from './utils/relationship-fields.js';
import {
  qualifyBaseColumn,
  resolveQualifiedExpression,
  type RelationshipBuilderContext,
} from './utils/relationship-builder-plan.js';
import { measureToAggregationSpec } from './utils/dataset-normalization.js';
import { validatePercentileLevel } from './measure.js';
import { assertAggregateStateFunction } from './utils/aggregate-state-functions.js';

type DatasetShape = AnyDatasetInstance;

export function resolveDimensionExpression(
  ds: DatasetShape,
  dimensionName: string,
  joinCtx: RelationshipBuilderContext | undefined,
  dialect: DatasetSqlDialectRules,
): string {
  if (joinCtx && isQualifiedField(dimensionName)) {
    return resolveQualifiedExpression(ds, dimensionName, joinCtx);
  }
  const definition = ds.dimensions[dimensionName];
  if (definition?.sql) {
    assertNoRawSqlUnderJoins('dimension', dimensionName, definition.sql, joinCtx);
    return definition.sql;
  }
  return qualifyBaseColumn(joinCtx, definition?.column ?? dimensionName, dialect);
}

export function resolveFilterField(
  ds: DatasetShape,
  filterField: string,
  joinCtx: RelationshipBuilderContext | undefined,
  dialect: DatasetSqlDialectRules,
): string {
  if (joinCtx && isQualifiedField(filterField)) {
    return resolveQualifiedExpression(ds, filterField, joinCtx);
  }
  const resolvedField = ds.filters[filterField]?.field ?? filterField;
  return resolveDimensionExpression(ds, resolvedField, joinCtx, dialect);
}

export function buildDimensionSelectionPlan(
  ds: DatasetShape,
  dimensions: string[],
  grain: TimeGrain | undefined,
  joinCtx: RelationshipBuilderContext | undefined,
  timezone: string | undefined,
  dialect: DatasetSqlDialectRules,
): { selectParts: string[]; groupByParts: string[] } {
  const selectParts: string[] = [];
  const groupByParts = new Set<string>();

  if (grain) {
    if (!isSupportedTimeGrain(grain)) {
      throw new Error(`Unsupported time grain "${grain}".`);
    }
    const time = resolveDimensionExpression(ds, String(ds.timeKey), joinCtx, dialect);
    const period = dialect.quoteIdentifier('period');
    // Bucket in the query timezone; group by the bucket itself when the
    // engine renders it differently (a wall clock repeats in a DST fall-back).
    const zoned = zonedDatasetSqlDialect(dialect, canonicalTimezone(timezone));
    const bucket = zoned.truncateTime(queryTimeSql(zoned, time, timezone), grain);
    const value = zoned.periodValue(bucket, grain);
    selectParts.push(`${value} AS ${period}`);
    groupByParts.add(value === bucket ? period : bucket);
  }

  for (const dimensionName of dimensions) {
    const expression = resolveDimensionExpression(ds, dimensionName, joinCtx, dialect);

    // Every generated alias is quoted: reserved words and engines that fold
    // unquoted case (Postgres) must keep the semantic name. With joins in
    // scope every selection is table-qualified, so it is always aliased.
    if (!joinCtx && expression === dialect.columnReference(dimensionName)) {
      selectParts.push(expression);
      groupByParts.add(expression);
    } else {
      const alias = dialect.quoteIdentifier(dimensionName);
      selectParts.push(`${expression} AS ${alias}`);
      // A qualified alias (`customer.tier`) can resolve to the physical joined
      // column, so group on its guarded expression: the match marker stays
      // part of the key whatever the engine's alias-resolution rules.
      groupByParts.add(joinCtx && isQualifiedField(dimensionName) ? expression : alias);
    }
  }

  return { selectParts, groupByParts: Array.from(groupByParts) };
}

export function applyAggregationSpec(
  qb: QueryBuilderLike,
  ds: DatasetShape,
  spec: AggregationSpec,
  name: string,
  joinCtx: RelationshipBuilderContext | undefined,
  dialect: DatasetSqlDialectRules,
  expressions?: { field: string; arg?: string },
): QueryBuilderLike {
  // The semantic name is the output alias, quoted so it survives reserved
  // words and case folding; messages keep the unquoted name.
  const alias = dialect.quoteIdentifier(name);
  if (spec.sql) {
    assertNoRawSqlUnderJoins('measure', name, spec.sql, joinCtx);
  }
  const fieldOrExpr = expressions?.field ?? applyFilteredAggregationExpression(
    ds,
    spec,
    spec.sql ?? resolveDimensionExpression(ds, spec.field, joinCtx, dialect),
    joinCtx,
    dialect,
  );

  switch (spec.aggregation) {
    case "sum":
      return qb.sum(fieldOrExpr, alias);
    case "count":
      return qb.count(fieldOrExpr, alias);
    case "countDistinct":
      return qb.countDistinct(fieldOrExpr, alias);
    case "avg":
      return qb.avg(fieldOrExpr, alias);
    case "min":
      return qb.min(fieldOrExpr, alias);
    case "max":
      return qb.max(fieldOrExpr, alias);
    case "argMax":
    case "argMin": {
      if (!spec.argField) {
        throw new Error(`Aggregation "${spec.aggregation}" for "${name}" requires an argField ("by" column).`);
      }
      const argExpr = expressions?.arg ?? resolveDimensionExpression(ds, spec.argField, joinCtx, dialect);
      if (spec.aggregation === "argMax") {
        if (!qb.argMax) {
          throw new Error('Query builder does not support argMax aggregations.');
        }
        return qb.argMax(fieldOrExpr, argExpr, alias);
      }
      if (!qb.argMin) {
        throw new Error('Query builder does not support argMin aggregations.');
      }
      return qb.argMin(fieldOrExpr, argExpr, alias);
    }
    case "percentile": {
      if (spec.level == null) {
        throw new Error(`Aggregation "percentile" for "${name}" requires a level.`);
      }
      validatePercentileLevel(spec.level);
      if (!qb.quantile) {
        throw new Error('Query builder does not support percentile aggregations.');
      }
      return qb.quantile(fieldOrExpr, spec.level, alias);
    }
    case "approxCountDistinct":
      if (!qb.approxCountDistinct) {
        throw new Error('Query builder does not support approxCountDistinct aggregations.');
      }
      return qb.approxCountDistinct(fieldOrExpr, alias);
    case "merge": {
      assertAggregateStateFunction(spec.stateFunction, `Measure "${name}"`);
      if (spec.filters?.length) {
        throw new Error(`Measure filters are not supported on merge aggregations ("${name}").`);
      }
      if (!qb.mergeState) {
        throw new Error('Query builder does not support merge aggregations (mergeState).');
      }
      return qb.mergeState(spec.stateFunction, fieldOrExpr, alias);
    }
    case "stddev":
      if (!qb.stddev) {
        throw new Error('Query builder does not support stddev aggregations.');
      }
      return qb.stddev(fieldOrExpr, alias);
    case "variance":
      if (!qb.variance) {
        throw new Error('Query builder does not support variance aggregations.');
      }
      return qb.variance(fieldOrExpr, alias);
    default:
      throw new Error(`Unknown aggregation type: ${spec.aggregation}`);
  }
}

export function applyMeasureDefinition(
  qb: QueryBuilderLike,
  ds: DatasetShape,
  name: string,
  definition: MeasureDefinition,
  joinCtx: RelationshipBuilderContext | undefined,
  dialect: DatasetSqlDialectRules,
): QueryBuilderLike {
  return applyAggregationSpec(qb, ds, measureToAggregationSpec(name, definition), name, joinCtx, dialect);
}

/**
 * Appends ORDER BY, LIMIT and OFFSET. Under joins, an order on a selected
 * qualified dimension repeats its guarded expression (the GROUP BY key) rather
 * than naming the alias, which the engine may resolve to the raw joined column;
 * any other qualified order (a related measure) sorts by its quoted alias.
 */
export function appendOrderLimitOffset(
  qb: QueryBuilderLike,
  orderBy: MetricOrderBy[] | undefined,
  grain: TimeGrain | undefined,
  limit: number | undefined,
  offset: number | undefined,
  joinCtx: RelationshipBuilderContext | undefined,
  dialect: DatasetSqlDialectRules,
  selection?: { ds: DatasetShape; dimensions: readonly string[] },
): QueryBuilderLike {
  if (orderBy && orderBy.length > 0) {
    for (const order of orderBy) {
      // A selected related dimension orders by its guarded expression, for the
      // same alias-resolution reason it groups by it.
      const column = joinCtx && isQualifiedField(order.field) && selection?.dimensions.includes(order.field)
        ? resolveDimensionExpression(selection.ds, order.field, joinCtx, dialect)
        : dialect.quoteIdentifier(order.field);
      qb = qb.orderBy(column, semanticOrderDirection(order.direction));
    }
  } else if (grain) {
    qb = qb.orderBy(dialect.quoteIdentifier("period"), "ASC");
  }

  if (limit != null) {
    qb = qb.limit(limit);
  }
  if (offset != null) {
    qb = qb.offset(offset);
  }

  return qb;
}

export function resolveTenantFilterColumn(
  ds: DatasetShape,
  context?: ExecutionContext,
): string | undefined {
  if (!getRuntimeTenantPredicate(context)) {
    return undefined;
  }

  return ds.tenantKey;
}
