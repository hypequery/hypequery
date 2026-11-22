/**
 * Contract-driven validation of a semantic operation.
 *
 * The deployment package deliberately depends only on `@hypequery/protocol`, so
 * every check here is made against the validated contract rather than by
 * loading the authoring package. A gateway must be able to reject a bad
 * invocation without any of the deploying application's code.
 */

import type {
  ProtocolDeploymentDatasetAnyVersion,
  ProtocolDeploymentDatasetV3,
  ProtocolExpression,
  ProtocolQueryTimeGrain,
  ProtocolSemanticQuery,
  ProtocolVisibleDatasetFields,
} from '@hypequery/protocol';
import { protocolFilterCapabilities } from './semantic-filter-capabilities.js';
import { effectiveFilterOperators, protocolFilterLeaves, type ProtocolFilterLeaf } from './utils/filter-leaves.js';
import { timeSeriesRangeViolation } from './utils/time-series-range.js';
import { fieldBackingColumn } from './utils/field-backing-column.js';

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

/** Invocation 1 refuses `minute` and `hour` before they reach this check (RFC 0015). */
const ALL_GRAINS: readonly ProtocolQueryTimeGrain[] = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
interface Resolved {
  /** Dimensions the caller may group by, including one-hop qualified names. */
  readonly groupable: ReadonlySet<string>;
  /** Filter name -> allowed operators. */
  readonly filters: ReadonlyMap<string, ReadonlySet<string>>;
  /** Filter keys implied by visible dimensions rather than declared aliases. */
  readonly impliedFilters: ReadonlySet<string>;
  readonly measures: ReadonlySet<string>;
  readonly grains: ReadonlySet<string>;
  /** Contract 3 segment names a caller may select. */
  readonly segments: ReadonlySet<string>;
}

/**
 * What a dataset exposes.
 *
 * A relationship contributes `<name>.<dimension>` for its target's groupable
 * dimensions, matching the one-hop rule the authoring layer enforces. Filters
 * over a relationship are accepted on the same qualified names, because the
 * contract has no separate filter declaration for a joined field.
 */
function resolveDataset(
  dataset: ProtocolDeploymentDatasetAnyVersion,
  datasets: ReadonlyMap<string, ProtocolDeploymentDatasetAnyVersion>,
): Resolved {
  const groupable = new Set<string>();
  const filters = new Map<string, ReadonlySet<string>>();
  const impliedFilters = new Set<string>();
  const local = protocolFilterCapabilities(dataset);

  for (const dimension of dataset.dimensions) {
    if (dimension.groupable) groupable.add(String(dimension.name));
  }
  for (const [name, operators] of local.dimensions) {
    filters.set(name, operators);
    impliedFilters.add(name);
  }
  for (const [name, filter] of local.named) {
    // A named filter keeps its alias. When its name matches a dimension it
    // replaces that key, exactly as datasets' effectiveFilters does.
    filters.set(name, new Set(filter.operators));
    impliedFilters.delete(name);
  }
  for (const relationship of dataset.relationships) {
    if (!relationship.queryable) continue;
    const target = datasets.get(String(relationship.target));
    if (!target) continue;
    const targetFilters = protocolFilterCapabilities(target);
    for (const dimension of target?.dimensions ?? []) {
      const qualified = `${String(relationship.name)}.${String(dimension.name)}`;
      // The two capabilities are declared separately and travel separately
      // across a join. Coupling them would both hide a filterable field that
      // cannot be grouped and expose one the target declared unfilterable.
      if (dimension.groupable) groupable.add(qualified);
      const operators = targetFilters.dimensions.get(String(dimension.name));
      if (operators) {
        filters.set(qualified, operators);
        impliedFilters.add(qualified);
      }
    }
  }

  return {
    groupable,
    filters,
    impliedFilters,
    measures: new Set((dataset.measures as readonly { readonly name: string }[]).map(measure => String(measure.name))),
    grains: new Set(dataset.timeField === undefined ? [] : ALL_GRAINS),
    segments: new Set(((dataset as ProtocolDeploymentDatasetV3).segments ?? []).map(segment => String(segment.name))),
  };
}

/**
 * Narrows what a dataset exposes to what a visibility policy lets this
 * principal see (RFC 0019). Hidden fields drop out of the same sets unknown
 * ones are missing from, so a refusal reads exactly like an unknown field and
 * does not confirm that the hidden one exists.
 */
function narrowResolvedToVisible(allowed: Resolved, visible: ProtocolVisibleDatasetFields): Resolved {
  return {
    groupable: new Set([...allowed.groupable].filter(name => visible.dimensions.has(name))),
    filters: new Map([...allowed.filters].filter(([name]) => (
      visible.filters.has(name)
      || (allowed.impliedFilters.has(name) && visible.dimensions.has(name))
    ))),
    impliedFilters: new Set([...allowed.impliedFilters].filter(name => visible.dimensions.has(name))),
    measures: new Set([...allowed.measures].filter(name => visible.measures.has(name))),
    grains: visible.timeField ? allowed.grains : new Set(),
    segments: visible.segments === undefined
      ? allowed.segments
      : new Set([...allowed.segments].filter(name => visible.segments!.has(name))),
  };
}

/**
 * The field a filter expression addresses, or null when it is not a plain
 * comparison.
 *
 * Both operands are checked. A right-hand side that is anything but a literal —
 * another reference, an aggregate, a nested comparison — addresses something
 * this validator never matched against the contract's allowlist, so accepting
 * it would leave a published-surface check to whichever executor happens to be
 * injected. It is also a caller mistake rather than a deployment capability
 * gap, and only a violation raised here reports it as one.
 */
function comparisonField(expression: ProtocolExpression): { field: string; operator: string } | null {
  if (expression.kind !== 'comparison' || expression.left.kind !== 'reference') return null;
  // A null check (RFC 0023) has no right operand; any other comparison needs a literal one.
  if ('right' in expression && expression.right.kind !== 'literal') return null;
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
  dataset: ProtocolDeploymentDatasetAnyVersion,
  datasets: ReadonlyMap<string, ProtocolDeploymentDatasetAnyVersion>,
  limits: SemanticOperationLimits,
  /** What the principal may see; omitted means everything the contract publishes. */
  visible?: ProtocolVisibleDatasetFields,
): readonly SemanticOperationViolation[] {
  const violations: SemanticOperationViolation[] = [];
  const fail = (message: string, path: string) => violations.push({ message, path });

  // A deployment carries no metric, so a metric operation addresses nothing the
  // contract published, whatever else it selects.
  if (operation.kind === 'metric') {
    fail(`Unknown metric "${String(operation.metric)}".`, '$.operation.metric');
    return violations;
  }

  const published = resolveDataset(dataset, datasets);
  const allowed = visible === undefined ? published : narrowResolvedToVisible(published, visible);

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

  // RFC 0029: the budget counts comparisons. A filter may be an and/or/not
  // tree; each leaf is checked as a top-level comparison is.
  const filters = (operation.filters ?? []).flatMap((expression, index) => (
    protocolFilterLeaves(expression, `$.operation.filters[${index}]`)
  ));
  if (filters.length > limits.maxFilters) {
    fail(`At most ${limits.maxFilters} filters may be applied.`, '$.operation.filters');
  }
  // RFC 0025: a `having` condition names a selected measure (the protocol
  // validator checked that), so a hidden or unknown one has already failed
  // above as a measure. Conditions share the filter budget, as the dataset
  // client and RFC 0018's `maxPredicates` count them.
  const having = operation.having ?? [];
  if (filters.length <= limits.maxFilters && filters.length + having.length > limits.maxFilters) {
    fail(
      `At most ${limits.maxFilters} filters and having conditions may be applied together.`,
      '$.operation.having',
    );
  }
  filters.forEach(({ expression, path, negated }) => {
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
    // Under `not`, the negation is what runs, so it is what must be allowed.
    const refused = effectiveFilterOperators(comparison.operator, negated)
      .find(operator => !operators.has(operator));
    if (refused !== undefined) {
      fail(
        refused === comparison.operator
          ? `Operator "${comparison.operator}" is not allowed on "${comparison.field}".`
          : `Operator "${refused}" (the negation of "${comparison.operator}") is not allowed on "${comparison.field}".`,
        `${path}.operator`,
      );
    }
  });

  // RFC 0029: a relative range filters a time axis; the executor resolves it.
  const namedFilters = protocolFilterCapabilities(dataset).named;
  const fieldOf = (leaf: ProtocolFilterLeaf) => {
    const comparison = comparisonField(leaf.expression);
    if (comparison === null) return undefined;
    return String(namedFilters.get(comparison.field)?.field ?? comparison.field);
  };
  const timeAxis = dataset.timeField === undefined || allowed.grains.size === 0
    ? undefined : String(dataset.timeField);
  // Compared by backing column: the time field may name the column a
  // differently named dimension reads.
  const axisColumn = timeAxis === undefined ? undefined : fieldBackingColumn(dataset, timeAxis);
  const onAxis = (leaf: ProtocolFilterLeaf) => {
    const field = fieldOf(leaf);
    return field !== undefined && fieldBackingColumn(dataset, field) === axisColumn;
  };
  filters.forEach(leaf => {
    if (comparisonField(leaf.expression)?.operator !== 'inDateRange') return;
    if (timeAxis === undefined || !onAxis(leaf)) {
      fail(
        timeAxis === undefined
          ? 'This dataset has no time field, so "inDateRange" does not apply.'
          : `"inDateRange" applies only to the time field "${timeAxis}".`,
        leaf.path,
      );
    }
  });
  // A filled series, like a window or shift measure, needs a bounded range.
  const timeMeasures = new Set((dataset.measures as readonly { name: string; kind?: string }[])
    .filter(measure => measure.kind === 'window' || measure.kind === 'shift')
    .map(measure => String(measure.name)));
  const series = operation.fill === true
    ? 'Filled queries'
    : measures.some(name => timeMeasures.has(String(name))) ? 'Window and shift measures' : undefined;
  if (series !== undefined && timeAxis !== undefined) {
    const violation = timeSeriesRangeViolation(filters, onAxis, timeAxis, series);
    if (violation) fail(violation.message, violation.path);
  }

  // RFC 0015: an unknown segment is refused like an unknown dimension, and a
  // hidden one reads exactly like an unknown one.
  (operation.segments ?? []).forEach((name, index) => {
    if (!allowed.segments.has(String(name))) {
      fail(`Unknown segment "${String(name)}".`, `$.operation.segments[${index}]`);
    }
  });

  const orderBy = operation.orderBy ?? [];
  const orderable = new Set<string>([
    ...allowed.groupable,
    ...allowed.measures,
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
  // A zone moves time buckets and time-key bounds; without a time field it
  // would change nothing, so it is refused rather than silently ignored.
  if (operation.timezone !== undefined && allowed.grains.size === 0) {
    fail('This dataset has no time field, so a timezone does not apply.', '$.operation.timezone');
  }

  if (operation.limit !== undefined && operation.limit > limits.maxRows) {
    fail(`The row limit may not exceed ${limits.maxRows}.`, '$.operation.limit');
  }
  if (operation.offset !== undefined && operation.offset > limits.maxOffset) {
    fail(`The offset may not exceed ${limits.maxOffset}.`, '$.operation.offset');
  }

  return violations;
}

/**
 * Validates filters the provider enforces on every call, such as an embedded
 * end user's account (RFC 0019). They are checked against what the contract
 * publishes, not against the caller's visibility: a provider may constrain on
 * a field the caller can't see.
 */
export function validateSemanticConstraints(
  constraints: readonly ProtocolExpression[],
  dataset: ProtocolDeploymentDatasetAnyVersion,
  datasets: ReadonlyMap<string, ProtocolDeploymentDatasetAnyVersion>,
): readonly SemanticOperationViolation[] {
  const violations: SemanticOperationViolation[] = [];
  const allowed = resolveDataset(dataset, datasets);
  constraints.forEach((expression, index) => {
    const path = `$.constraints[${index}]`;
    const comparison = comparisonField(expression);
    if (comparison === null) {
      violations.push({ message: 'A constraint must be a field/operator/value comparison.', path });
      return;
    }
    const operators = allowed.filters.get(comparison.field);
    if (operators === undefined || !operators.has(comparison.operator)) {
      violations.push({ message: 'The constraint cannot be enforced on this dataset.', path });
    }
  });
  return violations;
}
