import type {
  AgentCatalogDataset,
  AgentCatalogFilter,
  FieldType,
} from '@hypequery/datasets';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function fieldType(value: unknown): FieldType | undefined {
  return value === 'string' || value === 'number' || value === 'boolean' || value === 'timestamp'
    ? value
    : undefined;
}

function namedEntries(value: unknown): Array<[string, UnknownRecord]> {
  return Object.entries(record(value))
    .map(([name, entry]) => [name, record(entry)] as [string, UnknownRecord])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function optionalDescription(value: UnknownRecord): { label?: string; description?: string } {
  const label = text(value.label);
  const description = text(value.description);
  return {
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/** Safely adapts the pre-catalog, object-shaped MCP registry compatibility input. */
export function projectLegacyAgentDataset(name: string, input: UnknownRecord): AgentCatalogDataset {
  const config = record(input.config);
  const dimensions = namedEntries(input.dimensions)
    .map(([dimensionName, dimension]) => ({
      name: dimensionName,
      type: fieldType(dimension.fieldType ?? dimension.type),
      ...optionalDescription(dimension),
      filterable: dimension.filterable !== false,
      groupable: dimension.groupable !== false,
    }))
    .filter((dimension): dimension is typeof dimension & { type: FieldType } => (
      dimension.type !== undefined && (dimension.filterable || dimension.groupable)
    ));
  const dimensionTypes = new Map(dimensions.map(dimension => [dimension.name, dimension.type]));
  const filters = namedEntries(input.filters)
    .map(([filterName, filter]) => ({
      name: filterName,
      type: dimensionTypes.get(text(filter.field) ?? filterName),
      operators: Array.isArray(filter.operators)
        ? [...new Set(filter.operators.filter((operator): operator is string => typeof operator === 'string'))].sort()
        : [],
    }))
    .filter((filter): filter is AgentCatalogFilter => filter.type !== undefined);
  const timeKey = text(input.timeKey) ?? text(config.timeKey);

  return {
    name,
    description: text(input.description) ?? text(config.description) ?? `${name} analytics dataset.`,
    timeDimension: timeKey !== undefined && dimensionTypes.has(timeKey) ? timeKey : null,
    dimensions,
    measures: namedEntries(input.measures).map(([measureName, measure]) => ({
      name: measureName,
      ...optionalDescription(measure),
    })),
    metrics: namedEntries(input.metrics).map(([metricName, metric]) => ({
      name: metricName,
      ...optionalDescription(metric),
      dimensions: Array.isArray(metric.dimensions)
        ? metric.dimensions.filter((item): item is string => typeof item === 'string').sort()
        : [],
      filters: Array.isArray(metric.filters)
        ? metric.filters.filter((item): item is string => typeof item === 'string').sort()
        : [],
      grains: Array.isArray(metric.grains)
        ? metric.grains.filter((item): item is string => typeof item === 'string').sort()
        : [],
    })),
    filters,
    relationships: namedEntries(input.relationships)
      .filter(([, relationship]) => relationship.queryable !== false && relationship.kind !== 'hasMany')
      .map(([relationshipName, relationship]) => ({
        name: relationshipName,
        target: text(relationship.target) ?? text(record(relationship.dataset).name) ?? '',
        fields: Array.isArray(relationship.fields)
          ? relationship.fields.filter((item): item is string => typeof item === 'string').sort()
          : [],
      })),
    limits: record(input.limits) as AgentCatalogDataset['limits'],
  };
}
