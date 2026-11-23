import { isFilterGroup } from './filter-tree.js';
import {
  parseProtocolIdentifier, parseProtocolQualifiedIdentifier, validateCanonicalValue,
  type CanonicalValue, type ProtocolExpression, type ProtocolMetricDerivation,
} from '@hypequery/protocol';
import type { SemanticExpression } from '../semantic-plan.js';
import type { AggregationSpec, DerivedMeasureDefinition, DerivedMetricSpec, MeasureFilterNode, MetricFilter } from '../types.js';
import { requirePortableAggregation } from './portable-aggregations.js';

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
  // A null check carries no right operand (RFC 0023).
  if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
    return { kind: 'comparison', operator: filter.operator, left } satisfies ProtocolComparisonExpression;
  }
  // RFC 0003: `between` bounds are a two-item tuple; `in`/`notIn` take an array.
  const right: ProtocolLiteralExpression = {
    kind: 'literal',
    value: filter.operator === 'between' && Array.isArray(filter.value)
      ? validateCanonicalValue({
        $hypequery: { type: 'tuple', version: 1, values: filter.value.map(canonicalValue) },
      })
      : canonicalValue(filter.value),
  };
  const result: ProtocolComparisonExpression = {
    kind: 'comparison',
    operator: filter.operator,
    left,
    right,
  };
  return result;
}

/**
 * A measure's fixed filter node as an RFC 0003 predicate: a comparison as
 * `filterExpression` writes it, and an `and` / `or` / `not` group as the
 * matching `logical` expression, in authored order.
 */
export function measureFilterExpression(node: MeasureFilterNode): ProtocolExpression {
  if (!isFilterGroup(node)) return filterExpression(node);
  if ('not' in node && node.not !== undefined) {
    return { kind: 'logical', operator: 'not', operand: measureFilterExpression(node.not) } as ProtocolExpression;
  }
  const operator = 'and' in node && node.and !== undefined ? 'and' : 'or';
  const items = (operator === 'and' ? node.and : node.or) ?? [];
  return { kind: 'logical', operator, operands: items.map(measureFilterExpression) } as ProtocolExpression;
}

function aggregationExpression(spec: AggregationSpec): ProtocolExpression {
  const result: ProtocolAggregateExpression = {
    kind: 'aggregate',
    aggregation: requirePortableAggregation(spec.aggregation, `An aggregate over "${spec.field}"`),
    field: parseProtocolQualifiedIdentifier(spec.field),
    ...(spec.argField !== undefined
      ? { argField: parseProtocolQualifiedIdentifier(spec.argField) }
      : {}),
    ...(spec.level !== undefined ? { level: spec.level } : {}),
    ...(spec.filters?.length
      ? { filters: spec.filters.map(measureFilterExpression) }
      : {}),
  };
  return result;
}

type ReferenceName = (name: string) => ProtocolReferenceExpression['name'];

function semanticExpression(
  expression: SemanticExpression,
  references: Readonly<Record<string, ProtocolExpression>> = {},
  referenceName: ReferenceName = parseProtocolQualifiedIdentifier,
): ProtocolExpression {
  switch (expression.kind) {
    case 'ref':
      // Own properties only: an alias such as `constructor` must stay a reference.
      return Object.hasOwn(references, expression.name)
        ? references[expression.name]!
        : { kind: 'reference', name: referenceName(expression.name) } satisfies ProtocolReferenceExpression;
    case 'literal':
      return { kind: 'literal', value: canonicalValue(expression.value) };
    case 'binary':
      return {
        kind: 'binary',
        operator: expression.operator,
        left: semanticExpression(expression.left, references, referenceName),
        right: semanticExpression(expression.right, references, referenceName),
      } satisfies ProtocolBinaryExpression;
    case 'function':
      return {
        kind: 'call',
        function: expression.name,
        args: expression.args.map(argument => semanticExpression(argument, references, referenceName)),
      } satisfies ProtocolCallExpression;
  }
}

function derivedFormula(definition: DerivedMeasureDefinition): SemanticExpression {
  const aliases = Object.fromEntries(Object.keys(definition.uses).map(alias => [alias, alias]));
  return definition.formula(aliases).expression;
}

/** The published form; aliases must satisfy the protocol identifier grammar. */
export function derivedMeasureExpression(definition: DerivedMeasureDefinition): ProtocolExpression {
  return semanticExpression(derivedFormula(definition));
}

/**
 * The catalog form. Catalogs describe local datasets that may never be published,
 * so aliases keep their locally valid names (for example `__hypequery_value`, or
 * names past the protocol's length limit) instead of failing catalog creation.
 * Publishing still validates them through `derivedMeasureExpression`.
 */
export function derivedMeasureCatalogExpression(definition: DerivedMeasureDefinition): ProtocolExpression {
  return semanticExpression(derivedFormula(definition), {}, name => name as ProtocolReferenceExpression['name']);
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
