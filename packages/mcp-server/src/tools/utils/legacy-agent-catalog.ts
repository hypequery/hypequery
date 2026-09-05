import type {
  AgentCatalogDataset,
  AgentCatalogFilter,
  FieldType,
} from '@hypequery/datasets';

type UnknownRecord = Record<string, unknown>;

/**
 * Grains the semantic planner can actually execute. A legacy registry is
 * untyped, so anything outside this set is dropped rather than advertised.
 */
const TIME_GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);

/** The only limit keys the canonical projection emits. See `normalizedLimits`. */
const LIMIT_KEYS = ['maxDimensions', 'maxMeasures', 'maxFilters', 'maxResultSize'] as const;

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

/** Keeps only the members of `value` that name something the agent may already see. */
function declaredNames(value: unknown, declared: ReadonlySet<string>): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => (
      typeof item === 'string' && declared.has(item)
    )))].sort()
    : [];
}

/**
 * Normalizes the untyped `limits` object to the four keys the canonical
 * projection emits, so internal metadata a legacy registry happens to keep
 * alongside them is never serialized into a tool result.
 */
function legacyLimits(value: unknown): AgentCatalogDataset['limits'] {
  const limits = record(value);
  const normalized: Record<string, number> = {};
  for (const key of LIMIT_KEYS) {
    const limit = limits[key];
    if (typeof limit === 'number' && Number.isInteger(limit) && limit > 0) {
      normalized[key] = limit;
    }
  }
  return normalized as AgentCatalogDataset['limits'];
}

/** The dimensions a legacy registry entry exposes, in the shape the agent sees. */
function legacyDimensions(input: UnknownRecord): AgentCatalogDataset['dimensions'] {
  return namedEntries(input.dimensions)
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
      operators: Array.isArray(filter.operators)
        ? [...new Set(filter.operators.filter((operator): operator is string => typeof operator === 'string'))].sort()
        : [],
    }))
    .filter((filter): filter is AgentCatalogFilter => filter.type !== undefined);
  const filterNames = new Set(filters.map(filter => filter.name));
  const timeKey = text(input.timeKey) ?? text(config.timeKey);

  return {
    name,
    description: text(input.description) ?? text(config.description) ?? `${name} analytics dataset.`,
    timeDimension: timeKey !== undefined && dimensionNames.has(timeKey) ? timeKey : null,
    dimensions,
    measures: namedEntries(input.measures).map(([measureName, measure]) => ({
      name: measureName,
      ...optionalDescription(measure),
    })),
    metrics: namedEntries(input.metrics).map(([metricName, metric]) => ({
      name: metricName,
      ...optionalDescription(metric),
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
    limits: legacyLimits(input.limits),
  };
}
