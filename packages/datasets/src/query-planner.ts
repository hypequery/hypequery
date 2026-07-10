import type {
  AggregationSpec,
  AnyDatasetInstance,
  ExecutionContext,
  MeasureDefinition,
  MetricOrderBy,
  TimeGrain,
} from "./types.js";
import type { QueryBuilderLike } from "./query-builder-protocol.js";
import { GRAIN_FUNCTIONS } from "./constants.js";
import { applyFilteredAggregationExpression } from './utils/filtered-aggregation-sql.js';
import { getRuntimeTenantPredicate } from './utils/tenant-runtime.js';
import { quoteSQLIdentifier } from './sql-utils.js';
import { isQualifiedField } from './utils/relationship-fields.js';
import {
  qualifyBaseColumn,
  resolveQualifiedColumn,
  type RelationshipBuilderContext,
} from './utils/relationship-builder-plan.js';
import { measureToAggregationSpec } from './utils/dataset-normalization.js';
import { validatePercentileLevel } from './measure.js';

type DatasetShape = AnyDatasetInstance;

function toOrderDirection(direction: MetricOrderBy['direction']): 'ASC' | 'DESC' {
  return direction === 'asc' ? 'ASC' : 'DESC';
}

/**
 * Raw SQL expressions on the base dataset are emitted verbatim, so their column
 * references are not table-qualified. When relationship joins are active a bare
 * `price` in such an expression is ambiguous if the joined table also has a
 * `price` column. Until the builder rewrites identifiers inside expressions,
 * reject the combination rather than emit ambiguous SQL.
 */
function assertNoRawSqlUnderJoins(
  kind: 'dimension' | 'measure',
  name: string,
  sql: string,
  joinCtx?: RelationshipBuilderContext,
): void {
  if (!joinCtx) {
    return;
  }
  throw new Error(
    `SQL-backed ${kind} "${name}" cannot be combined with relationship joins: its expression ` +
    `("${sql}") is not table-qualified and may collide with joined columns. Query it without ` +
    `relationship-qualified fields, or redeclare it as a plain column.`,
  );
}

export function resolveDimensionExpression(
  ds: DatasetShape,
  dimensionName: string,
  joinCtx?: RelationshipBuilderContext,
): string {
  if (joinCtx && isQualifiedField(dimensionName)) {
    return resolveQualifiedColumn(ds, dimensionName);
  }
  const definition = ds.dimensions[dimensionName];
  if (definition?.sql) {
    assertNoRawSqlUnderJoins('dimension', dimensionName, definition.sql, joinCtx);
    return definition.sql;
  }
  return qualifyBaseColumn(joinCtx, definition?.column ?? dimensionName);
}

export function resolveFilterField(
  ds: DatasetShape,
  filterField: string,
  joinCtx?: RelationshipBuilderContext,
): string {
  if (joinCtx && isQualifiedField(filterField)) {
    return resolveQualifiedColumn(ds, filterField);
  }
  const resolvedField = ds.filters[filterField]?.field ?? filterField;
  return resolveDimensionExpression(ds, resolvedField, joinCtx);
}

export function buildDimensionSelectionPlan(
  ds: DatasetShape,
  dimensions: string[],
  grain: TimeGrain | undefined,
  joinCtx?: RelationshipBuilderContext,
): { selectParts: string[]; groupByParts: string[] } {
  const selectParts: string[] = [];
  const groupByParts = new Set<string>();

  if (grain) {
    const fn = GRAIN_FUNCTIONS[grain];
    if (!fn) {
      throw new Error(`Unsupported time grain "${grain}".`);
    }
    selectParts.push(`${fn}(${qualifyBaseColumn(joinCtx, String(ds.timeKey))}) AS period`);
    groupByParts.add("period");
  }

  for (const dimensionName of dimensions) {
    const expression = resolveDimensionExpression(ds, dimensionName, joinCtx);

    if (joinCtx) {
      // With joins in scope, every selection is table-qualified and aliased so
      // grouping/ordering can reference the alias unambiguously.
      const alias = isQualifiedField(dimensionName)
        ? quoteSQLIdentifier(dimensionName)
        : dimensionName;
      selectParts.push(`${expression} AS ${alias}`);
      groupByParts.add(alias);
    } else if (expression === dimensionName) {
      selectParts.push(dimensionName);
      groupByParts.add(dimensionName);
    } else {
      selectParts.push(`${expression} AS ${dimensionName}`);
      groupByParts.add(dimensionName);
    }
  }

  return { selectParts, groupByParts: Array.from(groupByParts) };
}

export function applyAggregationSpec(
  qb: QueryBuilderLike,
  ds: DatasetShape,
  spec: AggregationSpec,
  alias: string,
  joinCtx?: RelationshipBuilderContext,
): QueryBuilderLike {
  if (spec.sql) {
    assertNoRawSqlUnderJoins('measure', alias, spec.sql, joinCtx);
  }
  const fieldOrExpr = applyFilteredAggregationExpression(
    ds,
    spec,
    spec.sql ?? resolveDimensionExpression(ds, spec.field, joinCtx),
    joinCtx,
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
        throw new Error(`Aggregation "${spec.aggregation}" for "${alias}" requires an argField ("by" column).`);
      }
      const argExpr = resolveDimensionExpression(ds, spec.argField, joinCtx);
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
        throw new Error(`Aggregation "percentile" for "${alias}" requires a level.`);
      }
      validatePercentileLevel(spec.level);
      if (!qb.quantile) {
        throw new Error('Query builder does not support percentile aggregations.');
      }
      return qb.quantile(fieldOrExpr, spec.level, alias);
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
  joinCtx?: RelationshipBuilderContext,
): QueryBuilderLike {
  return applyAggregationSpec(qb, ds, measureToAggregationSpec(name, definition), name, joinCtx);
}

export function appendOrderLimitOffset(
  qb: QueryBuilderLike,
  orderBy: MetricOrderBy[] | undefined,
  grain: TimeGrain | undefined,
  limit?: number,
  offset?: number,
  joinCtx?: RelationshipBuilderContext,
): QueryBuilderLike {
  if (orderBy && orderBy.length > 0) {
    for (const order of orderBy) {
      const column = joinCtx && isQualifiedField(order.field)
        ? quoteSQLIdentifier(order.field)
        : order.field;
      qb = qb.orderBy(column, toOrderDirection(order.direction));
    }
  } else if (grain) {
    qb = qb.orderBy("period", "ASC");
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
