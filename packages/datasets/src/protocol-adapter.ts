import {
  validateCanonicalValue,
  validateProtocolDatasetContract,
  type CanonicalValue,
  type ProtocolDatasetContract,
  type ProtocolDatasetMetric,
  type ProtocolEndpointPolicy,
  type ProtocolExpression,
  type ProtocolSchema,
  type ProtocolSqlExpression,
} from '@hypequery/protocol';
import { SEMANTIC_FILTER_OPERATORS } from './constants.js';
import type { SemanticExpression } from './semantic-plan.js';
import type {
  AggregationSpec,
  AnyDatasetInstance,
  DerivedMetricSpec,
  FieldType,
  MetricFilter,
  MetricHandle,
  MetricRef,
} from './types.js';

export interface BuildProtocolDatasetContractOptions {
  readonly metrics?: Readonly<Record<string, MetricHandle>>;
  readonly endpoint?: ProtocolEndpointPolicy;
  readonly metricEndpoints?: Readonly<Record<string, ProtocolEndpointPolicy>>;
}

function byName<T extends { readonly name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name);
}

function fieldSchema(type: FieldType | undefined): ProtocolSchema {
  switch (type) {
    case 'string':
    case 'timestamp':
      return { kind: 'string' };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    default:
      return { kind: 'any' };
  }
}

function canonicalValue(input: unknown): CanonicalValue {
  if (Array.isArray(input)) {
    return validateCanonicalValue({
      $hypequery: {
        type: 'array',
        version: 1,
        values: input.map(canonicalValue),
      },
    });
  }
  if (typeof input === 'object' && input !== null) {
    if ('$hypequery' in input) return validateCanonicalValue(input);
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Dataset protocol adapter only accepts plain filter values.');
    }
    return validateCanonicalValue({
      $hypequery: {
        type: 'map',
        version: 1,
        entries: Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, canonicalValue(value)]),
      },
    });
  }
  return validateCanonicalValue(input);
}

function filterExpression(filter: MetricFilter): ProtocolExpression {
  return {
    kind: 'comparison',
    operator: filter.operator,
    left: { kind: 'reference', name: filter.field },
    right: { kind: 'literal', value: canonicalValue(filter.value) },
  } as unknown as ProtocolExpression;
}

function aggregationExpression(spec: AggregationSpec): ProtocolExpression {
  return {
    kind: 'aggregate',
    aggregation: spec.aggregation,
    field: spec.field,
    ...(spec.argField !== undefined ? { argField: spec.argField } : {}),
    ...(spec.level !== undefined ? { level: spec.level } : {}),
    ...(spec.filters?.length
      ? { filters: spec.filters.map(filterExpression) }
      : {}),
  } as unknown as ProtocolExpression;
}

function semanticExpression(
  expression: SemanticExpression,
  references: Readonly<Record<string, ProtocolExpression>> = {},
): ProtocolExpression {
  switch (expression.kind) {
    case 'ref':
      return references[expression.name]
        ?? ({ kind: 'reference', name: expression.name } as unknown as ProtocolExpression);
    case 'literal':
      return { kind: 'literal', value: canonicalValue(expression.value) };
    case 'binary':
      return {
        kind: 'binary',
        operator: expression.operator,
        left: semanticExpression(expression.left, references),
        right: semanticExpression(expression.right, references),
      } as unknown as ProtocolExpression;
    case 'function':
      return {
        kind: 'call',
        function: expression.name,
        args: expression.args.map(argument => semanticExpression(argument, references)),
      } as unknown as ProtocolExpression;
  }
}

function unwrapMetric(metric: MetricHandle): {
  readonly ref: MetricRef;
  readonly grain?: 'day' | 'week' | 'month' | 'quarter' | 'year';
} {
  return metric.__type === 'grained_metric_ref'
    ? { ref: metric.metric, grain: metric.grain }
    : { ref: metric };
}

function metricExpression(spec: AggregationSpec | DerivedMetricSpec): ProtocolExpression {
  if (spec.__type === 'aggregation_spec') return aggregationExpression(spec);
  const aliases = Object.fromEntries(Object.keys(spec.uses).map(alias => [alias, alias]));
  const references = Object.fromEntries(Object.entries(spec.uses).map(([alias, metric]) => [
    alias,
    aggregationExpression(metric.spec),
  ]));
  return semanticExpression(spec.formula(aliases).expression, references);
}

function metricContract(
  exposedName: string,
  metric: MetricHandle,
  endpoint: ProtocolEndpointPolicy,
): ProtocolDatasetMetric {
  const { ref, grain } = unwrapMetric(metric);
  const contract = metric.contract();
  return {
    name: exposedName,
    kind: grain
      ? 'grained-metric'
      : ref.spec.__type === 'derived_metric_spec'
        ? 'derived-metric'
        : 'metric',
    expression: metricExpression(ref.spec),
    dimensions: [...contract.dimensions].sort(),
    filters: [...contract.filters].sort(),
    grains: [...contract.grains].sort(),
    ...(grain !== undefined ? { grain } : {}),
    ...(ref.label !== undefined ? { label: ref.label } : {}),
    ...(ref.description !== undefined ? { description: ref.description } : {}),
    endpoint,
  } as unknown as ProtocolDatasetMetric;
}

function sqlExpression(
  sql: string,
  output: ProtocolSchema,
  dependencies: readonly string[],
): ProtocolSqlExpression {
  return {
    kind: 'sql-expression',
    dialect: 'clickhouse',
    sql,
    output,
    dependencies,
  } as unknown as ProtocolSqlExpression;
}

/**
 * Converts one existing Dataset instance into the versioned deployment
 * contract consumed by protocol-aware build and runtime tooling.
 */
export function buildProtocolDatasetContract(
  dataset: AnyDatasetInstance,
  options: BuildProtocolDatasetContractOptions = {},
): ProtocolDatasetContract {
  const dependencies = Object.entries(dataset.dimensions)
    .filter(([, dimension]) => dimension.sql === undefined)
    .map(([name]) => name)
    .sort();
  const metrics = Object.entries(options.metrics ?? {})
    .filter(([, metric]) => unwrapMetric(metric).ref.datasetName === dataset.name)
    .map(([name, metric]) => {
      const endpoint = options.metricEndpoints?.[name];
      if (!endpoint) {
        throw new Error(`Missing protocol endpoint policy for metric "${name}".`);
      }
      return metricContract(name, metric, endpoint);
    })
    .sort(byName);

  const contract = {
    name: dataset.name,
    source: dataset.source,
    tenant: dataset.tenantKey
      ? { kind: 'required', field: dataset.tenantKey }
      : { kind: 'not-required' },
    ...(dataset.timeKey !== undefined ? { timeField: dataset.timeKey } : {}),
    dimensions: Object.entries(dataset.dimensions).map(([name, dimension]) => ({
      name,
      type: dimension.fieldType,
      source: dimension.sql !== undefined
        ? sqlExpression(dimension.sql, fieldSchema(dimension.fieldType), dependencies)
        : { kind: 'column' as const, column: dimension.column ?? name },
      filterable: dimension.filterable !== false,
      groupable: dimension.groupable !== false,
      ...(dimension.label !== undefined ? { label: dimension.label } : {}),
      ...(dimension.description !== undefined ? { description: dimension.description } : {}),
    })).sort(byName),
    measures: Object.entries(dataset.measures).map(([name, measure]) => ({
      name,
      aggregation: measure.aggregation,
      field: measure.field,
      ...(measure.argField !== undefined ? { argField: measure.argField } : {}),
      ...(measure.level !== undefined ? { level: measure.level } : {}),
      ...(measure.sql !== undefined
        ? {
            sql: sqlExpression(
              measure.sql,
              fieldSchema(dataset.dimensions[measure.field]?.fieldType),
              dependencies,
            ),
          }
        : {}),
      filters: (measure.filters ?? []).map(filterExpression),
      ...(measure.label !== undefined ? { label: measure.label } : {}),
      ...(measure.description !== undefined ? { description: measure.description } : {}),
    })).sort(byName),
    filters: Object.entries(dataset.filters).map(([name, filter]) => ({
      name,
      field: filter.field,
      operators: [...(filter.operators ?? SEMANTIC_FILTER_OPERATORS)],
      ...(filter.label !== undefined ? { label: filter.label } : {}),
      ...(filter.description !== undefined ? { description: filter.description } : {}),
    })).sort(byName),
    metrics,
    relationships: Object.entries(dataset.relationships).map(([name, relationship]) => ({
      name,
      kind: relationship.kind,
      target: relationship.target().name,
      from: relationship.from,
      to: relationship.to,
      queryable: relationship.kind !== 'hasMany',
    })).sort(byName),
    ...(dataset.limits !== undefined
      ? {
          limits: {
            ...(dataset.limits.maxDimensions !== undefined
              ? { maxDimensions: dataset.limits.maxDimensions }
              : {}),
            ...(dataset.limits.maxMeasures !== undefined
              ? { maxMeasures: dataset.limits.maxMeasures }
              : {}),
            ...(dataset.limits.maxFilters !== undefined
              ? { maxFilters: dataset.limits.maxFilters }
              : {}),
            ...(dataset.limits.maxResultSize !== undefined
              ? { maxResultSize: dataset.limits.maxResultSize }
              : {}),
          },
        }
      : {}),
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
  };

  // Reuse the protocol validator for strict identifiers, expression limits,
  // and a deeply immutable return value. Cross-dataset references are checked
  // by the containing deployment validator.
  return validateProtocolDatasetContract(contract);
}
