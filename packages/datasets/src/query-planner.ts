import type {
  AggregationSpec,
  DatasetInstance,
  ExecutionContext,
  MeasureDefinition,
  MetricOrderBy,
  TimeGrain,
} from "./types.js";
import type { QueryBuilderLike } from "./query-builder-protocol.js";
import { GRAIN_FUNCTIONS } from "./constants.js";

export function resolveDimensionExpression(
  ds: DatasetInstance,
  dimensionName: string,
): string {
  const definition = ds.dimensions[dimensionName];
  return definition?.sql ?? definition?.column ?? dimensionName;
}

export function resolveFilterField(
  ds: DatasetInstance,
  filterField: string,
): string {
  const resolvedField = ds.filters[filterField]?.field ?? filterField;
  return resolveDimensionExpression(ds, resolvedField);
}

export function buildDimensionSelectionPlan(
  ds: DatasetInstance,
  dimensions: string[],
  grain: TimeGrain | undefined,
): { selectParts: string[]; groupByParts: string[] } {
  const selectParts: string[] = [];
  const groupByParts: string[] = [];

  if (grain) {
    const fn = GRAIN_FUNCTIONS[grain];
    selectParts.push(`${fn}(${ds.timeKey}) AS period`);
    groupByParts.push("period");
  }

  for (const dimensionName of dimensions) {
    const expression = resolveDimensionExpression(ds, dimensionName);
    if (expression === dimensionName) {
      selectParts.push(dimensionName);
    } else {
      selectParts.push(`${expression} AS ${dimensionName}`);
    }
    groupByParts.push(dimensionName);
  }

  return { selectParts, groupByParts };
}

export function applyAggregationSpec(
  qb: QueryBuilderLike,
  spec: AggregationSpec,
  alias: string,
): QueryBuilderLike {
  switch (spec.aggregation) {
    case "sum":
      return qb.sum(spec.field, alias);
    case "count":
      return qb.count(spec.field, alias);
    case "countDistinct":
      return qb.countDistinct(spec.field, alias);
    case "avg":
      return qb.avg(spec.field, alias);
    case "min":
      return qb.min(spec.field, alias);
    case "max":
      return qb.max(spec.field, alias);
    default:
      throw new Error(`Unknown aggregation type: ${spec.aggregation}`);
  }
}

export function applyMeasureDefinition(
  qb: QueryBuilderLike,
  name: string,
  definition: MeasureDefinition,
): QueryBuilderLike {
  const fieldOrExpr = definition.sql ?? definition.field;

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
  _ds: DatasetInstance,
  context?: ExecutionContext,
): string | undefined {
  return context?.runtime?.tenant?.column;
}
