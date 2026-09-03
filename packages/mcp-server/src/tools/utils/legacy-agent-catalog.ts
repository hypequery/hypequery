import type {
  AgentCatalogDataset,
  AgentCatalogFilter,
  DatasetDefaults,
  DatasetFreshness,
  DatasetLimits,
  FieldType,
  SemanticMetadata,
  SemanticSensitivity,
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

function semanticMetadata(value: UnknownRecord): SemanticMetadata {
  const list = (input: unknown): string[] | undefined => Array.isArray(input)
    ? [...new Set(input.filter((item): item is string => typeof item === 'string'))].sort()
    : undefined;
  const sensitivity = ['public', 'internal', 'confidential', 'restricted'].includes(String(value.sensitivity))
    ? value.sensitivity as SemanticSensitivity
    : undefined;
  return {
    ...(list(value.examples) !== undefined ? { examples: list(value.examples) } : {}),
    ...(list(value.synonyms) !== undefined ? { synonyms: list(value.synonyms) } : {}),
    ...(text(value.format) !== undefined ? { format: text(value.format) } : {}),
    ...(text(value.unit) !== undefined ? { unit: text(value.unit) } : {}),
    ...(/^[A-Z]{3}$/.test(String(value.currency)) ? { currency: String(value.currency) } : {}),
    ...(text(value.timezone) !== undefined ? { timezone: text(value.timezone) } : {}),
    ...(sensitivity !== undefined ? { sensitivity } : {}),
  };
}

function limits(value: unknown): DatasetLimits {
  const input = record(value);
  const result: DatasetLimits = {};
  for (const key of ['maxDimensions', 'maxMeasures', 'maxFilters', 'maxResultSize'] as const) {
    const candidate = input[key];
    if (Number.isSafeInteger(candidate) && (candidate as number) > 0) result[key] = candidate as number;
  }
  return result;
}

/** Safely adapts the pre-catalog, object-shaped MCP registry compatibility input. */
export function projectLegacyAgentDataset(name: string, input: UnknownRecord): AgentCatalogDataset {
  const config = record(input.config);
  const dimensions = namedEntries(input.dimensions)
    .map(([dimensionName, dimension]) => ({
      name: dimensionName,
      type: fieldType(dimension.fieldType ?? dimension.type),
      ...optionalDescription(dimension),
      ...semanticMetadata(dimension),
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
      ...optionalDescription(filter),
      ...semanticMetadata(filter),
      operators: Array.isArray(filter.operators)
        ? [...new Set(filter.operators.filter((operator): operator is string => typeof operator === 'string'))].sort()
        : [],
    }))
    .filter((filter): filter is AgentCatalogFilter => filter.type !== undefined);
  const timeKey = text(input.timeKey) ?? text(config.timeKey);
  const freshnessInput = record(input.freshness);
  const freshness = Number.isSafeInteger(freshnessInput.maxAgeSeconds)
    && (freshnessInput.maxAgeSeconds as number) > 0
    ? { maxAgeSeconds: freshnessInput.maxAgeSeconds as number } satisfies DatasetFreshness
    : undefined;
  const defaultsInput = record(input.defaults);
  const defaultDimensions = Array.isArray(defaultsInput.dimensions)
    ? defaultsInput.dimensions.filter((item): item is string => typeof item === 'string').sort()
    : undefined;
  const timeGrain = ['day', 'week', 'month', 'quarter', 'year'].includes(String(defaultsInput.timeGrain))
    ? defaultsInput.timeGrain as DatasetDefaults['timeGrain']
    : undefined;
  const defaults = defaultDimensions !== undefined || timeGrain !== undefined
    ? {
        ...(defaultDimensions !== undefined ? { dimensions: defaultDimensions } : {}),
        ...(timeGrain !== undefined ? { timeGrain } : {}),
      }
    : undefined;

  return {
    name,
    description: text(input.description) ?? text(config.description) ?? `${name} analytics dataset.`,
    ...semanticMetadata(input),
    ...(freshness !== undefined ? { freshness } : {}),
    ...(text(input.owner) !== undefined ? { owner: text(input.owner) } : {}),
    ...(defaults !== undefined ? { defaults } : {}),
    timeDimension: timeKey !== undefined && dimensionTypes.has(timeKey) ? timeKey : null,
    dimensions,
    measures: namedEntries(input.measures).map(([measureName, measure]) => ({
      name: measureName,
      ...optionalDescription(measure),
      ...semanticMetadata(measure),
    })),
    metrics: namedEntries(input.metrics).map(([metricName, metric]) => ({
      name: metricName,
      ...optionalDescription(metric),
      ...semanticMetadata(metric),
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
    limits: limits(input.limits),
  };
}
