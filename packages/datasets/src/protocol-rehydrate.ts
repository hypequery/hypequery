/**
 * Rebuilds executable datasets from a portable deployment contract.
 *
 * The inverse of `protocol-adapter.ts`. Decision 0005 chose portable native
 * execution, which means a runtime resolves a dataset from the validated active
 * contract and plans the query with the existing semantic planner — no customer
 * module is loaded. This is the function that makes the contract executable.
 *
 * Rehydration deliberately routes through the public `dataset()` factory rather
 * than assembling an instance by hand, so a rebuilt dataset is constructed by
 * exactly the same code path as an authored one. That is what makes the
 * byte-identical SQL claim mitigated by construction rather than by review.
 */

import type {
  ProtocolDatasetContract,
  ProtocolDatasetMeasure,
  ProtocolDatasetMetric,
} from '@hypequery/protocol';
import { dataset } from './dataset.js';
import type {
  AnyDatasetInstance,
  DatasetCachePolicy,
  DimensionDefinition,
  MeasureDefinition,
  MetricContract,
  MetricFilter,
  MetricHandle,
  RelationshipDefinition,
  SemanticFilterDefinition,
  TimeGrain,
} from './types.js';
import { rehydrateMeasureFilter } from './utils/protocol-rehydrate-filters.js';

/** A rebuilt dataset in the registry shape Serve, MCP, and the planner accept. */
export type RehydratedDataset = AnyDatasetInstance & {
  readonly metrics: Readonly<Record<string, MetricHandle>>;
};

export interface RehydrateProtocolDatasetsOptions {
  /**
   * Cache policy for the rebuilt datasets. Not carried by the contract — it is
   * an operational concern of whoever runs the query, not of the deployment.
   */
  readonly cache?: DatasetCachePolicy;
}

/**
 * Thrown when a contract describes something portable execution cannot rebuild.
 *
 * Callers map this onto the `unsupported-capability` invocation failure rather
 * than executing an approximation, as decision 0005 requires.
 */
export class UnsupportedContractFeatureError extends Error {
  readonly dataset: string;
  readonly feature: string;

  constructor(datasetName: string, feature: string, detail: string) {
    super(`Cannot rebuild ${feature} on dataset "${datasetName}": ${detail}`);
    this.name = 'UnsupportedContractFeatureError';
    this.dataset = datasetName;
    this.feature = feature;
  }
}

function rehydrateDimensions(
  contract: ProtocolDatasetContract,
): Record<string, DimensionDefinition> {
  const dimensions: Record<string, DimensionDefinition> = {};
  for (const dimension of contract.dimensions) {
    const name = String(dimension.name);
    const source = dimension.source;
    dimensions[name] = {
      __type: 'field_definition',
      fieldType: dimension.type,
      label: dimension.label,
      description: dimension.description,
      // A column source always carries its column, including when it matches
      // the dimension name — the forward adapter defaults it, so dropping it
      // here would still round-trip but would lose an authored mapping.
      column: source.kind === 'column' ? source.column : undefined,
      sql: source.kind === 'column' ? undefined : source.sql,
      dependencies: source.kind === 'column' ? undefined : [...source.dependencies],
      filterable: dimension.filterable,
      groupable: dimension.groupable,
    };
  }
  return dimensions;
}

function rehydrateMeasure(
  datasetName: string,
  measure: ProtocolDatasetMeasure,
): MeasureDefinition {
  const filters = measure.filters.map((expression, index) => rehydrateMeasureFilter(
    expression,
    () => new UnsupportedContractFeatureError(
      datasetName,
      `measure "${String(measure.name)}"`,
      `fixed filter ${index} is not a field/operator/value comparison`,
    ),
  ));
  return {
    __type: 'measure_definition',
    aggregation: measure.aggregation,
    field: String(measure.field),
    ...(measure.argField !== undefined ? { argField: String(measure.argField) } : {}),
    ...(measure.level !== undefined ? { level: measure.level } : {}),
    ...(measure.sql !== undefined
      ? { sql: measure.sql.sql, dependencies: [...measure.sql.dependencies] }
      : {}),
    ...(measure.label !== undefined ? { label: measure.label } : {}),
    ...(measure.description !== undefined ? { description: measure.description } : {}),
    ...(filters.length > 0 ? { filters: filters as MetricFilter[] } : {}),
  };
}

function rehydrateFilters(
  contract: ProtocolDatasetContract,
): Record<string, SemanticFilterDefinition> {
  const filters: Record<string, SemanticFilterDefinition> = {};
  for (const filter of contract.filters) {
    filters[String(filter.name)] = {
      __type: 'filter_definition',
      field: String(filter.field),
      operators: [...filter.operators],
      ...(filter.label !== undefined ? { label: filter.label } : {}),
      ...(filter.description !== undefined ? { description: filter.description } : {}),
    } as SemanticFilterDefinition;
  }
  return filters;
}

function rehydrateRelationships(
  contract: ProtocolDatasetContract,
  resolve: (target: string) => AnyDatasetInstance,
): Record<string, RelationshipDefinition> {
  const relationships: Record<string, RelationshipDefinition> = {};
  for (const relationship of contract.relationships) {
    const target = String(relationship.target);
    relationships[String(relationship.name)] = {
      __type: 'relationship',
      kind: relationship.kind,
      // Resolved on call: datasets in one contract may reference each other, so
      // the target may not be built yet when this relationship is created.
      target: () => resolve(target),
      from: String(relationship.from),
      to: String(relationship.to),
    };
  }
  return relationships;
}

function rehydrateMetric(
  instance: AnyDatasetInstance,
  metric: ProtocolDatasetMetric,
): MetricHandle {
  const name = String(metric.name);
  if (metric.kind === 'derived-metric') {
    // The symbolic expression a derived metric needs is not carried by contract
    // v1; CORE-17 adds it. Until then this fails closed rather than guessing.
    throw new UnsupportedContractFeatureError(
      instance.name,
      `metric "${name}"`,
      'a derived metric requires its symbolic expression, which deployment contract v1 does not carry',
    );
  }
  const expression = metric.expression;
  if (expression.kind !== 'aggregate') {
    throw new UnsupportedContractFeatureError(
      instance.name,
      `metric "${name}"`,
      `expected an aggregate expression, received "${expression.kind}"`,
    );
  }
  const field = String(expression.field);
  const measureName = Object.entries(instance.measures).find(([, measure]) => (
    measure.aggregation === expression.aggregation
    && measure.field === field
    && measure.argField === (expression.argField === undefined
      ? undefined
      : String(expression.argField))
    && measure.level === expression.level
  ))?.[0];
  if (measureName === undefined) {
    throw new UnsupportedContractFeatureError(
      instance.name,
      `metric "${name}"`,
      `no declared measure matches ${expression.aggregation}(${field})`,
    );
  }

  const base = instance.metric(name, {
    measure: measureName,
    ...(metric.label !== undefined ? { label: metric.label } : {}),
    ...(metric.description !== undefined ? { description: metric.description } : {}),
  }) as MetricHandle;
  const handle = metric.grain === undefined
    ? base
    : (base as { by(grain: TimeGrain): MetricHandle }).by(metric.grain as TimeGrain);
  return withContractCapabilities(handle, metric);
}

/**
 * Pins a rebuilt metric to the capabilities the contract declared.
 *
 * `dataset.metric()` derives queryable dimensions, filters, and grains from the
 * whole dataset, but a deployed metric may expose a narrower set — the contract
 * is authoritative. Without this, rehydration silently widens a metric, and an
 * agent is offered a dimension the deployment never published.
 */
function withContractCapabilities(
  handle: MetricHandle,
  metric: ProtocolDatasetMetric,
): MetricHandle {
  const capabilities = {
    dimensions: metric.dimensions.map(String),
    filters: metric.filters.map(String),
    grains: [...metric.grains] as TimeGrain[],
  };
  const pin = <T extends { contract(): MetricContract }>(target: T): T => Object.assign(
    Object.create(Object.getPrototypeOf(target) as object),
    target,
    { contract: () => ({ ...target.contract(), ...capabilities }) },
  ) as T;

  return handle.__type === 'grained_metric_ref'
    // A grained handle carries the underlying ref, which the catalog and the
    // forward adapter both read, so pin them together.
    ? Object.assign(pin(handle), { metric: pin(handle.metric) })
    : pin(handle);
}

/**
 * Rebuild every dataset in a validated deployment contract.
 *
 * Datasets are returned keyed by contract name with their named metrics
 * attached, which is the registry shape `getDatasetCatalog`,
 * `projectAgentSafeCatalog`, and `DatasetClient` already accept.
 */
export function rehydrateProtocolDatasets(
  contracts: readonly ProtocolDatasetContract[],
  options: RehydrateProtocolDatasetsOptions = {},
): Readonly<Record<string, RehydratedDataset>> {
  const instances = new Map<string, AnyDatasetInstance>();
  const registry: Record<string, RehydratedDataset> = {};
  // Relationship targets resolve to the published entry, not the bare instance
  // built below, so a caller that follows a relationship lands on the same
  // object the registry exposes. Safe because `target()` is only called after
  // the registry is complete.
  const resolve = (target: string): AnyDatasetInstance => {
    const instance = registry[target] ?? instances.get(target);
    if (!instance) {
      // The deployment validator already rejects a dangling relationship, so
      // reaching this means the caller passed a partial contract.
      throw new UnsupportedContractFeatureError(
        target,
        'relationship target',
        `dataset "${target}" is not part of the supplied contract`,
      );
    }
    return instance;
  };

  for (const contract of contracts) {
    const name = String(contract.name);
    const instance = dataset(name, {
      source: contract.source,
      ...(contract.tenant.kind === 'required' ? { tenantKey: contract.tenant.field } : {}),
      ...(contract.timeField !== undefined ? { timeKey: String(contract.timeField) } : {}),
      dimensions: rehydrateDimensions(contract),
      measures: Object.fromEntries(contract.measures.map(measure => [
        String(measure.name),
        rehydrateMeasure(name, measure),
      ])),
      filters: rehydrateFilters(contract),
      relationships: rehydrateRelationships(contract, resolve),
      ...(contract.limits !== undefined ? { limits: { ...contract.limits } } : {}),
      ...(options.cache !== undefined ? { cache: options.cache } : {}),
    } as Parameters<typeof dataset>[1]) as unknown as AnyDatasetInstance;
    instances.set(name, instance);
  }

  for (const contract of contracts) {
    const name = String(contract.name);
    const instance = instances.get(name) as AnyDatasetInstance;
    const metrics: Record<string, MetricHandle> = {};
    for (const metric of contract.metrics) {
      metrics[String(metric.name)] = rehydrateMetric(instance, metric);
    }
    registry[name] = Object.assign(
      Object.create(Object.getPrototypeOf(instance) as object),
      instance,
      { metrics },
    ) as RehydratedDataset;
  }
  return registry;
}
