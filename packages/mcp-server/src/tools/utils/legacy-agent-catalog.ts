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

/**
 * Grains the semantic planner can actually execute. A legacy registry is
 * untyped, so anything outside this set is dropped rather than advertised.
 */
const TIME_GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);

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

/** Keeps only the members of `value` that name something the agent may already see. */
function declaredNames(value: unknown, declared: ReadonlySet<string>): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => (
      typeof item === 'string' && declared.has(item)
    )))].sort()
    : [];
}

/** The dimensions a legacy registry entry exposes, in the shape the agent sees. */
function legacyDimensions(input: UnknownRecord): AgentCatalogDataset['dimensions'] {
  return namedEntries(input.dimensions)
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
}

/**
 * Safely adapts the pre-catalog, object-shaped MCP registry compatibility input.
 *
 * A legacy entry is arbitrary user data, so every name it carries is checked
 * against what this projection already publishes before it is emitted:
 * references that do not resolve to a declared dimension, filter, grain, or
 * sibling dataset are dropped rather than passed through. Otherwise a physical
 * column or tenant key sitting in a legacy `metrics`/`relationships` block
 * would reach the agent through `get_dataset_schema`.
 *
 * `registry` is the surrounding dataset map, used to resolve relationship
 * targets. A relationship whose target is not in it is unreachable, so it is
 * omitted instead of advertising a name the agent cannot query.
 */
export function projectLegacyAgentDataset(
  name: string,
  input: UnknownRecord,
  registry: Readonly<Record<string, unknown>> = {},
): AgentCatalogDataset {
  const config = record(input.config);
  const dimensions = legacyDimensions(input);
  const dimensionTypes = new Map(dimensions.map(dimension => [dimension.name, dimension.type]));
  const dimensionNames = new Set(dimensionTypes.keys());
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
  const filterNames = new Set(filters.map(filter => filter.name));
  const timeKey = text(input.timeKey) ?? text(config.timeKey);
  const freshnessInput = record(input.freshness);
  const freshness = Number.isSafeInteger(freshnessInput.maxAgeSeconds)
    && (freshnessInput.maxAgeSeconds as number) > 0
    ? { maxAgeSeconds: freshnessInput.maxAgeSeconds as number } satisfies DatasetFreshness
    : undefined;
  const defaultsInput = record(input.defaults);
  const defaultDimensions = Array.isArray(defaultsInput.dimensions)
    ? declaredNames(defaultsInput.dimensions, dimensionNames)
    : undefined;
  const timeGrain = TIME_GRAINS.has(String(defaultsInput.timeGrain))
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
    timeDimension: timeKey !== undefined && dimensionNames.has(timeKey) ? timeKey : null,
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
      dimensions: declaredNames(metric.dimensions, dimensionNames),
      filters: declaredNames(metric.filters, filterNames),
      grains: declaredNames(metric.grains, TIME_GRAINS),
    })),
    filters,
    relationships: namedEntries(input.relationships)
      .filter(([, relationship]) => relationship.queryable !== false && relationship.kind !== 'hasMany')
      .map(([relationshipName, relationship]) => {
        const target = text(relationship.target) ?? text(record(relationship.dataset).name);
        if (target === undefined || !Object.prototype.hasOwnProperty.call(registry, target)) {
          return undefined;
        }
        // A queryable relationship field is exactly `<relationship>.<dimension>`
        // over a single hop, addressing a dimension the target already
        // publishes. See `listQueryableRelationshipFields`.
        const targetDimensions = new Set(
          legacyDimensions(record(registry[target])).map(dimension => dimension.name),
        );
        return {
          name: relationshipName,
          target,
          fields: declaredNames(
            relationship.fields,
            new Set([...targetDimensions].map(field => `${relationshipName}.${field}`)),
          ),
        };
      })
      .filter((relationship): relationship is NonNullable<typeof relationship> => (
        relationship !== undefined
      )),
    limits: limits(input.limits),
  };
}
