import {
  parseProtocolIdentifier, parseProtocolQualifiedIdentifier, validateCanonicalValue,
  type CanonicalValue, type ProtocolExpression, type ProtocolMetricDerivation,
} from '@hypequery/protocol';
import type { SemanticExpression } from '../semantic-plan.js';
import type { AggregationSpec, DerivedMetricSpec, MetricFilter } from '../types.js';

type ProtocolReferenceExpression = Extract<ProtocolExpression, { readonly kind: 'reference' }>;
type ProtocolLiteralExpression = Extract<ProtocolExpression, { readonly kind: 'literal' }>;
type ProtocolBinaryExpression = Extract<ProtocolExpression, { readonly kind: 'binary' }>;
type ProtocolCallExpression = Extract<ProtocolExpression, { readonly kind: 'call' }>;
type ProtocolComparisonExpression = Extract<ProtocolExpression, { readonly kind: 'comparison' }>;
type ProtocolAggregateExpression = Extract<ProtocolExpression, { readonly kind: 'aggregate' }>;

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

export function filterExpression(filter: MetricFilter): ProtocolExpression {
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

export function metricExpression(spec: AggregationSpec | DerivedMetricSpec): ProtocolExpression {
  if (spec.__type === 'aggregation_spec') return aggregationExpression(spec);
  const aliases = Object.fromEntries(Object.keys(spec.uses).map(alias => [alias, alias]));
  const references = Object.fromEntries(Object.entries(spec.uses).map(([alias, metric]) => [
    alias,
    aggregationExpression(metric.spec),
  ]));
  return semanticExpression(spec.formula(aliases).expression, references);
}

/**
 * The formula in the shape it was authored in, beside the inlined form.
 *
 * `metricExpression` above substitutes each input's aggregate where the formula
 * named it, which states what the metric means but drops the aliases. Those
 * aliases are the column names of the intermediate aggregate, so a catalog
 * rebuilt without them computes the same number through different SQL.
 *
 * Input order follows `uses` and is not sorted: each entry becomes a column of
 * that intermediate result in this order.
 */
export function metricDerivation(spec: DerivedMetricSpec): ProtocolMetricDerivation {
  const aliases = Object.fromEntries(Object.keys(spec.uses).map(alias => [alias, alias]));
  return {
    inputs: Object.entries(spec.uses).map(([alias, metric]) => ({
      alias: parseProtocolIdentifier(alias),
      expression: aggregationExpression(metric.spec),
    })),
    expression: semanticExpression(spec.formula(aliases).expression),
  };
}

