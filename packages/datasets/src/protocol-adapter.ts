import {
  parseProtocolIdentifier,
  parseProtocolQualifiedIdentifier,
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

type ProtocolReferenceExpression = Extract<ProtocolExpression, { readonly kind: 'reference' }>;
type ProtocolLiteralExpression = Extract<ProtocolExpression, { readonly kind: 'literal' }>;
type ProtocolBinaryExpression = Extract<ProtocolExpression, { readonly kind: 'binary' }>;
type ProtocolCallExpression = Extract<ProtocolExpression, { readonly kind: 'call' }>;
type ProtocolComparisonExpression = Extract<ProtocolExpression, { readonly kind: 'comparison' }>;
type ProtocolAggregateExpression = Extract<ProtocolExpression, { readonly kind: 'aggregate' }>;

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
  const left: ProtocolReferenceExpression = {
    kind: 'reference',
    name: parseProtocolQualifiedIdentifier(filter.field),
  };
  const right: ProtocolLiteralExpression = {
    kind: 'literal',
    value: canonicalValue(filter.value),
  };
  const result: ProtocolComparisonExpression = {
    kind: 'comparison',
    operator: filter.operator,
    left,
    right,
  };
  return result;
}

function aggregationExpression(spec: AggregationSpec): ProtocolExpression {
  const result: ProtocolAggregateExpression = {
    kind: 'aggregate',
    aggregation: spec.aggregation,
    field: parseProtocolQualifiedIdentifier(spec.field),
    ...(spec.argField !== undefined
      ? { argField: parseProtocolQualifiedIdentifier(spec.argField) }
      : {}),
    ...(spec.level !== undefined ? { level: spec.level } : {}),
    ...(spec.filters?.length
      ? { filters: spec.filters.map(filterExpression) }
      : {}),
  };
  return result;
}

function semanticExpression(
  expression: SemanticExpression,
  references: Readonly<Record<string, ProtocolExpression>> = {},
): ProtocolExpression {
  switch (expression.kind) {
    case 'ref':
      return references[expression.name]
        ?? {
          kind: 'reference',
          name: parseProtocolQualifiedIdentifier(expression.name),
        } satisfies ProtocolReferenceExpression;
    case 'literal':
      return { kind: 'literal', value: canonicalValue(expression.value) };
    case 'binary':
      return {
        kind: 'binary',
        operator: expression.operator,
        left: semanticExpression(expression.left, references),
        right: semanticExpression(expression.right, references),
      } satisfies ProtocolBinaryExpression;
    case 'function':
      return {
        kind: 'call',
        function: expression.name,
        args: expression.args.map(argument => semanticExpression(argument, references)),
      } satisfies ProtocolCallExpression;
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
  const result: ProtocolDatasetMetric = {
    name: parseProtocolIdentifier(exposedName),
    kind: grain
      ? 'grained-metric'
      : ref.spec.__type === 'derived_metric_spec'
        ? 'derived-metric'
        : 'metric',
    expression: metricExpression(ref.spec),
    dimensions: [...contract.dimensions].sort().map(parseProtocolQualifiedIdentifier),
    filters: [...contract.filters].sort().map(parseProtocolIdentifier),
    grains: [...contract.grains].sort(),
    ...(grain !== undefined ? { grain } : {}),
    ...(ref.label !== undefined ? { label: ref.label } : {}),
    ...(ref.description !== undefined ? { description: ref.description } : {}),
    endpoint,
  };
  return result;
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
    dependencies: [...dependencies].sort().map(parseProtocolQualifiedIdentifier),
  };
}

function requiredSqlDependencies(
  kind: 'dimension' | 'measure',
  name: string,
  dependencies: readonly string[] | undefined,
): readonly string[] {
  if (dependencies === undefined) {
    throw new Error(
      `SQL-backed ${kind} "${name}" must declare dependencies for the protocol artifact.`,
    );
  }
  return dependencies;
}

/**
 * Converts one existing Dataset instance into the versioned deployment
 * contract consumed by protocol-aware build and runtime tooling.
 */
export function buildProtocolDatasetContract(
  dataset: AnyDatasetInstance,
  options: BuildProtocolDatasetContractOptions = {},
): ProtocolDatasetContract {
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
        ? sqlExpression(
            dimension.sql,
            fieldSchema(dimension.fieldType),
            requiredSqlDependencies('dimension', name, dimension.dependencies),
          )
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
              requiredSqlDependencies('measure', name, measure.dependencies),
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
