import type {
  AggregationSpec,
  DatasetConfig,
  DimensionDefinition,
  MeasureDefinition,
  RelationshipDefinition,
  SemanticFiltersDefinition,
} from '../types.js';

type AnyMeasures = Record<string, MeasureDefinition>;
type AnyRelationships = Record<string, RelationshipDefinition>;

export function normalizeDimensions<TDimensions extends Record<string, DimensionDefinition>>(
  config: DatasetConfig<TDimensions, AnyMeasures, AnyRelationships>,
): TDimensions {
  return config.dimensions;
}

export function normalizeFilters(
  dimensions: Record<string, DimensionDefinition>,
  filters?: SemanticFiltersDefinition,
): SemanticFiltersDefinition {
  if (filters) {
    return filters;
  }

  return Object.fromEntries(
    Object.entries(dimensions)
      .filter(([, definition]) => definition.filterable !== false)
      .map(([name]) => [
        name,
        {
          __type: 'filter_definition' as const,
          field: name,
        },
      ]),
  );
}

export function normalizeMeasures<TMeasures extends Record<string, MeasureDefinition>>(
  measures: TMeasures | undefined,
): TMeasures {
  return (measures ?? {}) as TMeasures;
}

export function normalizeRelationships<TRelationships extends Record<string, RelationshipDefinition>>(
  relationships: TRelationships | undefined,
  source: string,
): TRelationships {
  for (const name of Object.keys(relationships ?? {})) {
    if (name === source) {
      throw new Error(
        `Invalid relationship "${name}": the name matches the dataset source table, so the join ` +
        'alias would shadow the base table and produce ambiguous SQL. Rename the relationship.',
      );
    }
    if (name.includes('.')) {
      throw new Error(
        `Invalid relationship "${name}": relationship names cannot contain "." because qualified ` +
        'fields are addressed as "<relationship>.<dimension>".',
      );
    }
  }
  return (relationships ?? {}) as TRelationships;
}

export function measureToAggregationSpec(
  measureName: string,
  definition: MeasureDefinition,
): AggregationSpec {
  if (!definition.field) {
    throw new Error(`Invalid measure "${measureName}": a backing field is required.`);
  }

  return {
    __type: 'aggregation_spec',
    aggregation: definition.aggregation,
    field: definition.field,
    sql: definition.sql,
    filters: definition.filters,
  };
}
