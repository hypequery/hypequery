import type {
  DatasetInstance,
  DimensionDefinition,
  MeasureDefinition,
  MetricOrderBy,
  RelationshipDefinition,
  TimeGrain,
} from '@hypequery/datasets';
import type { QueryBuilderLike } from '@hypequery/datasets';
import { GRAIN_FUNCTIONS } from '@hypequery/datasets';
import { applyFilteredAggregationExpression } from './utils/filtered-aggregation-sql.js';

type DatasetShape = DatasetInstance<
  Record<string, DimensionDefinition>,
  Record<string, MeasureDefinition>,
  Record<string, RelationshipDefinition>
>;

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
    groupByParts.add('period');
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

export function applyMeasureDefinition(
  qb: QueryBuilderLike,
  ds: DatasetShape,
  name: string,
  definition: MeasureDefinition,
): QueryBuilderLike {
  const baseFieldOrExpr = definition.sql ?? resolveDimensionExpression(ds, definition.field);
  const fieldOrExpr = applyFilteredAggregationExpression(ds, {
    __type: 'aggregation_spec',
    aggregation: definition.aggregation,
    field: definition.field,
    filters: definition.filters,
  }, baseFieldOrExpr, resolveFilterField);

  switch (definition.aggregation) {
    case 'sum':
      return qb.sum(fieldOrExpr, name);
    case 'count':
      return qb.count(fieldOrExpr, name);
    case 'countDistinct':
      return qb.countDistinct(fieldOrExpr, name);
    case 'avg':
      return qb.avg(fieldOrExpr, name);
    case 'min':
      return qb.min(fieldOrExpr, name);
    case 'max':
      return qb.max(fieldOrExpr, name);
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
      qb = qb.orderBy(order.field, order.direction.toUpperCase() as 'ASC' | 'DESC');
    }
  } else if (grain) {
    qb = qb.orderBy('period', 'ASC');
  }

  if (limit != null) {
    qb = qb.limit(limit);
  }
  if (offset != null) {
    qb = qb.offset(offset);
  }

  return qb;
}
