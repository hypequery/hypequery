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
import { measureToAggregationSpec } from './utils/dataset-normalization.js';
import { validatePercentileLevel } from './measure.js';

type DatasetShape = AnyDatasetInstance;

function toOrderDirection(direction: MetricOrderBy['direction']): 'ASC' | 'DESC' {
  return direction === 'asc' ? 'ASC' : 'DESC';
}

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
    if (!fn) {
      throw new Error(`Unsupported time grain "${grain}".`);
    }
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
    spec.sql ?? resolveDimensionExpression(ds, spec.field),
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
      const argExpr = resolveDimensionExpression(ds, spec.argField);
      return spec.aggregation === "argMax"
        ? qb.argMax(fieldOrExpr, argExpr, alias)
        : qb.argMin(fieldOrExpr, argExpr, alias);
    }
    case "percentile": {
      if (spec.level == null) {
        throw new Error(`Aggregation "percentile" for "${alias}" requires a level.`);
      }
      validatePercentileLevel(spec.level);
      return qb.quantile(fieldOrExpr, spec.level, alias);
    }
    case "stddev":
      return qb.stddev(fieldOrExpr, alias);
    case "variance":
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
): QueryBuilderLike {
  return applyAggregationSpec(qb, ds, measureToAggregationSpec(name, definition), name);
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
      qb = qb.orderBy(order.field, toOrderDirection(order.direction));
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
