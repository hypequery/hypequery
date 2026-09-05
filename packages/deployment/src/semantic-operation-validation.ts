/**
 * Contract-driven validation of a semantic operation.
 *
 * The deployment package deliberately depends only on `@hypequery/protocol`, so
 * every check here is made against the validated contract rather than by
 * loading the authoring package. A gateway must be able to reject a bad
 * invocation without any of the deploying application's code.
 */

import type {
  ProtocolDatasetContract,
  ProtocolDatasetMetric,
  ProtocolExpression,
  ProtocolSemanticQuery,
  ProtocolTimeGrain,
} from '@hypequery/protocol';

export interface SemanticOperationViolation {
  readonly message: string;
  readonly path: string;
}

export interface SemanticOperationLimits {
  /** Largest row count the caller may ask for after every ceiling is applied. */
  readonly maxRows: number;
  readonly maxOffset: number;
  readonly maxDimensions: number;
  readonly maxMeasures: number;
  readonly maxFilters: number;
}

const ALL_GRAINS: readonly ProtocolTimeGrain[] = ['day', 'week', 'month', 'quarter', 'year'];

interface Resolved {
  /** Dimensions the caller may group by, including one-hop qualified names. */
  readonly groupable: ReadonlySet<string>;
  /** Filter name -> allowed operators. */
  readonly filters: ReadonlyMap<string, ReadonlySet<string>>;
  readonly measures: ReadonlySet<string>;
  readonly grains: ReadonlySet<string>;
}

/**
 * What a dataset exposes, before any metric narrows it.
 *
 * A relationship contributes `<name>.<dimension>` for its target's groupable
 * dimensions, matching the one-hop rule the authoring layer enforces. Filters
 * over a relationship are accepted on the same qualified names, because the
 * contract has no separate filter declaration for a joined field.
 */
function resolveDataset(
  dataset: ProtocolDatasetContract,
  datasets: ReadonlyMap<string, ProtocolDatasetContract>,
): Resolved {
  const groupable = new Set<string>();
  const filters = new Map<string, ReadonlySet<string>>();

  for (const dimension of dataset.dimensions) {
    if (dimension.groupable) groupable.add(String(dimension.name));
  }
  for (const filter of dataset.filters) {
    filters.set(String(filter.name), new Set(filter.operators));
  }
  for (const relationship of dataset.relationships) {
    if (!relationship.queryable) continue;
    const target = datasets.get(String(relationship.target));
    for (const dimension of target?.dimensions ?? []) {
      if (!dimension.groupable) continue;
      const qualified = `${String(relationship.name)}.${String(dimension.name)}`;
      groupable.add(qualified);
      // A joined field has no named filter in the contract, so it accepts the
      // full operator set the protocol allows rather than a narrowed list.
      filters.set(qualified, new Set([
        'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like',
      ]));
    }
  }

  return {
    groupable,
    filters,
    measures: new Set(dataset.measures.map(measure => String(measure.name))),
    grains: new Set(dataset.timeField === undefined ? [] : ALL_GRAINS),
  };
}

/** A metric may only narrow what its dataset exposes, never widen it. */
function narrowToMetric(base: Resolved, metric: ProtocolDatasetMetric): Resolved {
  const declaredDimensions = new Set(metric.dimensions.map(String));
  const declaredFilters = new Set(metric.filters.map(String));
  return {
    groupable: new Set([...base.groupable].filter(name => declaredDimensions.has(name))),
    filters: new Map(
      [...base.filters].filter(([name]) => declaredFilters.has(name)),
    ),
    // A metric selects itself; a caller cannot add measures to it.
    measures: new Set<string>(),
    grains: new Set(
      metric.grain === undefined
        ? metric.grains.filter(grain => base.grains.has(grain))
        : [metric.grain],
    ),
  };
}

/** The field a filter expression addresses, or null when it is not a plain comparison. */
function comparisonField(expression: ProtocolExpression): { field: string; operator: string } | null {
  if (expression.kind !== 'comparison') return null;
  if (expression.left.kind !== 'reference') return null;
  return { field: String(expression.left.name), operator: expression.operator };
}

/**
 * Validates one semantic operation against the contract that will serve it.
 *
 * Returns every violation rather than the first, so a caller correcting an
 * agent-authored query sees the whole problem in one round trip.
 */
export function validateSemanticOperation(
  operation: ProtocolSemanticQuery,
  dataset: ProtocolDatasetContract,
  datasets: ReadonlyMap<string, ProtocolDatasetContract>,
  limits: SemanticOperationLimits,
): readonly SemanticOperationViolation[] {
  const violations: SemanticOperationViolation[] = [];
  const fail = (message: string, path: string) => violations.push({ message, path });

  let metric: ProtocolDatasetMetric | undefined;
  if (operation.kind === 'metric') {
    metric = dataset.metrics.find(entry => String(entry.name) === String(operation.metric));
    if (metric === undefined) {
      fail(`Unknown metric "${String(operation.metric)}".`, '$.operation.metric');
      return violations;
    }
  }

  const base = resolveDataset(dataset, datasets);
  const allowed = metric === undefined ? base : narrowToMetric(base, metric);

  const dimensions = operation.dimensions ?? [];
  if (dimensions.length > limits.maxDimensions) {
    fail(`At most ${limits.maxDimensions} dimensions may be selected.`, '$.operation.dimensions');
  }
  dimensions.forEach((name, index) => {
    if (!allowed.groupable.has(String(name))) {
      fail(`Unknown or non-groupable dimension "${String(name)}".`, `$.operation.dimensions[${index}]`);
    }
  });
  if (new Set(dimensions.map(String)).size !== dimensions.length) {
    fail('Dimensions must be unique.', '$.operation.dimensions');
  }

  if (operation.kind === 'dataset') {
    const measures = operation.measures ?? [];
    if (measures.length > limits.maxMeasures) {
      fail(`At most ${limits.maxMeasures} measures may be selected.`, '$.operation.measures');
    }
    measures.forEach((name, index) => {
      if (!allowed.measures.has(String(name))) {
        fail(`Unknown measure "${String(name)}".`, `$.operation.measures[${index}]`);
      }
    });
    if (dimensions.length === 0 && measures.length === 0) {
      fail('At least one dimension or measure must be selected.', '$.operation');
    }
  }

  const filters = operation.filters ?? [];
  if (filters.length > limits.maxFilters) {
    fail(`At most ${limits.maxFilters} filters may be applied.`, '$.operation.filters');
  }
  filters.forEach((expression, index) => {
    const path = `$.operation.filters[${index}]`;
    const comparison = comparisonField(expression);
    if (comparison === null) {
      // Only `field <operator> value` is expressible against a contract; a
      // richer expression could reference something the contract never
      // published.
      fail('Only a field/operator/value comparison may be filtered on.', path);
      return;
    }
    const operators = allowed.filters.get(comparison.field);
    if (operators === undefined) {
      fail(`Unknown or unfilterable field "${comparison.field}".`, path);
      return;
    }
    if (!operators.has(comparison.operator)) {
      fail(
        `Operator "${comparison.operator}" is not allowed on "${comparison.field}".`,
        `${path}.operator`,
      );
    }
  });

  const orderBy = operation.orderBy ?? [];
  const orderable = new Set<string>([
    ...allowed.groupable,
    ...allowed.measures,
    ...(metric === undefined ? [] : [String(metric.name)]),
    ...(operation.by === undefined ? [] : ['period']),
  ]);
  orderBy.forEach((entry, index) => {
    if (!orderable.has(String(entry.field))) {
      fail(`Cannot order by "${String(entry.field)}".`, `$.operation.orderBy[${index}].field`);
    }
  });

  if (operation.by !== undefined && !allowed.grains.has(operation.by)) {
    fail(`Time grain "${operation.by}" is not supported here.`, '$.operation.by');
  }

  if (operation.limit !== undefined && operation.limit > limits.maxRows) {
    fail(`The row limit may not exceed ${limits.maxRows}.`, '$.operation.limit');
  }
  if (operation.offset !== undefined && operation.offset > limits.maxOffset) {
    fail(`The offset may not exceed ${limits.maxOffset}.`, '$.operation.offset');
  }

  return violations;
}
