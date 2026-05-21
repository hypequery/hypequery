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

type DatasetShape = AnyDatasetInstance;

export function resolveDimensionExpression(
  ds: DatasetShape,
  dimensionName: string,
): string {
  const definition = ds.dimensions[dimensionName];
  return definition?.sql ?? definition?.column ?? dimensionName;
}

export function resolveFilterField(
  ds: DatasetShape,
  filterField: string,
): string {
  const resolvedField = ds.filters[filterField]?.field ?? filterField;
  return resolveDimensionExpression(ds, resolvedField);
}

export function buildDimensionSelectionPlan(
  ds: DatasetShape,
  dimensions: string[],
  grain: TimeGrain | undefined,
): { selectParts: string[]; groupByParts: string[] } {
  const selectParts: string[] = [];
  const groupByParts = new Set<string>();

  if (grain) {
    const fn = GRAIN_FUNCTIONS[grain];
    selectParts.push(`${fn}(${ds.timeKey}) AS period`);
    groupByParts.add("period");
  }

  for (const dimensionName of dimensions) {
    const expression = resolveDimensionExpression(ds, dimensionName);
    if (expression === dimensionName) {
      selectParts.push(dimensionName);
    } else {
      selectParts.push(`${expression} AS ${dimensionName}`);
    }
    groupByParts.add(dimensionName);
  }

  return { selectParts, groupByParts: Array.from(groupByParts) };
}

export function applyAggregationSpec(
  qb: QueryBuilderLike,
  ds: DatasetShape,
  spec: AggregationSpec,
  alias: string,
): QueryBuilderLike {
  const fieldOrExpr = applyFilteredAggregationExpression(
    ds,
    spec,
    resolveDimensionExpression(ds, spec.field),
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
    default:
      throw new Error(`Unknown aggregation type: ${spec.aggregation}`);
  }
}

export function applyMeasureDefinition(
  qb: QueryBuilderLike,
  ds: DatasetShape,
  name: string,
  definition: MeasureDefinition,
): QueryBuilderLike {
  const fieldOrExpr = definition.sql ?? resolveDimensionExpression(ds, definition.field);

  switch (definition.aggregation) {
    case "sum":
      return qb.sum(fieldOrExpr, name);
    case "count":
      return qb.count(fieldOrExpr, name);
    case "countDistinct":
      return qb.countDistinct(fieldOrExpr, name);
    case "avg":
      return qb.avg(fieldOrExpr, name);
    case "min":
      return qb.min(fieldOrExpr, name);
    case "max":
      return qb.max(fieldOrExpr, name);
    default:
      throw new Error(`Unsupported measure aggregation: ${definition.aggregation}`);
  }
}

export function appendOrderLimitOffset(
  qb: QueryBuilderLike,
  orderBy: MetricOrderBy[] | undefined,
  grain: TimeGrain | undefined,
  limit?: number,
  offset?: number,
): QueryBuilderLike {
  if (orderBy && orderBy.length > 0) {
    for (const order of orderBy) {
      qb = qb.orderBy(order.field, order.direction.toUpperCase() as "ASC" | "DESC");
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
  if (!context?.runtime?.tenant?.id) {
    return undefined;
  }

  return ds.tenantKey;
}
