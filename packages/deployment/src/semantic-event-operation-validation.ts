/**
 * Contract-driven validation of RFC 0027 event operations (funnel).
 *
 * The protocol validator already checked syntax, closed records and
 * structural limits. What remains depends on the contract and the caller:
 * whether the dataset declares events, whether every field exists and may be
 * used by this principal, the bounded time range, and the row budget.
 */

import {
  PROTOCOL_EVENT_OPERATION_LIMITS,
  parseProtocolRelativeDateRange,
  type ProtocolDeploymentDatasetAnyVersion,
  type ProtocolEventOperation,
  type ProtocolExpression,
  type ProtocolVisibleDatasetFields,
} from '@hypequery/protocol';
import {
  resolveSemanticAllowedFields,
  semanticComparisonField,
  type SemanticAllowedFields,
  type SemanticOperationViolation,
} from './semantic-operation-validation.js';
import { protocolFilterCapabilities } from './semantic-filter-capabilities.js';
import { effectiveFilterOperators, protocolFilterLeaves, type ProtocolFilterLeaf } from './utils/filter-leaves.js';
import { timeSeriesRangeViolation } from './utils/time-series-range.js';
import {
  estimateEventBuckets,
  estimatePlacementFreeBuckets,
  eventRangeDays,
  eventTimeRange,
} from './utils/event-time-range.js';

export interface SemanticEventOperationLimits {
  /** Largest row count the result may have after every ceiling is applied. */
  readonly maxRows: number;
  /** Filters plus every condition, after enforced constraints are counted. */
  readonly maxFilters: number;
  /** Grouping fields: the entity plus each breakdown dimension. */
  readonly maxDimensions: number;
}

function isTimeDimension(dataset: ProtocolDeploymentDatasetAnyVersion, name: string): boolean {
  return dataset.dimensions.some(dimension => String(dimension.name) === name && dimension.type === 'timestamp');
}

/** The dimension a filter name addresses: a declared alias's field, or the name itself. */
function filterTarget(dataset: ProtocolDeploymentDatasetAnyVersion, name: string): string {
  const declared = protocolFilterCapabilities(dataset).named.get(name);
  return declared === undefined ? name : String(declared.field);
}

/**
 * One comparison leaf of a filter or condition tree (RFC 0029), checked as a
 * dataset query's is: a plain `field <operator> literal`, on a field the
 * caller may filter, with the operator it applies once `not` is pushed down.
 */
function checkLeaf(
  leaf: ProtocolFilterLeaf,
  allowed: SemanticAllowedFields,
  fail: (message: string, path: string) => void,
): { field: string; operator: string } | undefined {
  const comparison = semanticComparisonField(leaf.expression);
  if (comparison === null) {
    fail('Only a field/operator/value comparison may be filtered on.', leaf.path);
    return undefined;
  }
  const operators = allowed.filters.get(comparison.field);
  if (operators === undefined) {
    fail(`Unknown or unfilterable field "${comparison.field}".`, leaf.path);
    return undefined;
  }
  const refused = effectiveFilterOperators(comparison.operator, leaf.negated).find(operator => !operators.has(operator));
  if (refused !== undefined) {
    fail(
      refused === comparison.operator
        ? `Operator "${comparison.operator}" is not allowed on "${comparison.field}".`
        : `Operator "${refused}" (the negation of "${comparison.operator}") is not allowed on "${comparison.field}".`,
      `${leaf.path}.operator`,
    );
  }
  return comparison;
}

/** Where a relative range's worst-case span is placed to count its buckets: a month start. */
const RELATIVE_ANCHOR_MS = Date.UTC(2001, 0, 1);

const UNIT_MAX_DAYS = { day: 1, week: 7, month: 31, quarter: 92, year: 366 } as const;

/**
 * The longest span a relative range (RFC 0029) can cover, without a clock:
 * the executor resolves it against its own, so the data plane bounds it.
 */
function relativeRangeDays(value: unknown): number | undefined {
  const range = parseProtocolRelativeDateRange(value);
  if (range === undefined) return undefined;
  if (range.kind === 'today' || range.kind === 'yesterday') return 1;
  return (range.kind === 'last' ? range.count : 1) * UNIT_MAX_DAYS[range.unit];
}

/** `{ name, where }` lists the operation tests events against. */
function conditionLists(operation: ProtocolEventOperation): { path: string; where: readonly ProtocolExpression[] }[] {
  return operation.steps.map((step, index) => ({ path: `$.operation.steps[${index}].where`, where: step.where }));
}

/** Rows the operation can return, before execution, from its range and options. */
function estimatedRows(operation: ProtocolEventOperation, buckets: number | undefined): number {
  const groups = operation.breakdown === undefined
    ? 1
    : operation.breakdownLimit ?? PROTOCOL_EVENT_OPERATION_LIMITS.defaultBreakdownLimit;
  return (buckets ?? 1) * groups * operation.steps.length;
}

/**
 * Validates one RFC 0027 operation against the contract that will serve it.
 * Returns every violation, so an agent correcting a call sees the whole
 * problem in one round trip. Hidden fields fail exactly like unknown ones.
 */
export function validateSemanticEventOperation(
  operation: ProtocolEventOperation,
  dataset: ProtocolDeploymentDatasetAnyVersion,
  datasets: ReadonlyMap<string, ProtocolDeploymentDatasetAnyVersion>,
  limits: SemanticEventOperationLimits,
  visible?: ProtocolVisibleDatasetFields,
): readonly SemanticOperationViolation[] {
  const violations: SemanticOperationViolation[] = [];
  const fail = (message: string, path: string) => violations.push({ message, path });

  if (dataset.events === undefined) {
    fail(`Dataset "${String(dataset.name)}" does not declare events, so it has no ${operation.kind}.`, '$.operation.dataset');
    return violations;
  }
  const allowed = resolveSemanticAllowedFields(dataset, datasets, visible);
  const timeField = dataset.timeField === undefined ? undefined : String(dataset.timeField);

  // Entity and breakdown values are grouped on, so they follow grouping rules;
  // a relationship-qualified name or a time dimension is never one.
  const groupable = (name: string) => !name.includes('.') && allowed.groupable.has(name) && !isTimeDimension(dataset, name);
  const entity = String(operation.entity ?? dataset.events.entity);
  if (!groupable(entity)) {
    fail(`Unknown or non-groupable entity "${entity}".`, operation.entity === undefined ? '$.operation.dataset' : '$.operation.entity');
  }
  // The executor groups by the entity and every breakdown dimension, so they
  // share the dataset's dimension ceiling as a dataset query's would.
  if (1 + (operation.breakdown?.length ?? 0) > limits.maxDimensions) {
    fail(
      `At most ${limits.maxDimensions} grouping fields (the entity and breakdown dimensions) may be used.`,
      operation.breakdown === undefined ? '$.operation' : '$.operation.breakdown',
    );
  }
  (operation.breakdown ?? []).forEach((name, index) => {
    if (!groupable(String(name))) {
      fail(`Unknown or non-groupable dimension "${String(name)}".`, `$.operation.breakdown[${index}]`);
    }
  });

  // Conditions select which events count as a step; the time range belongs
  // in `filters`, so a condition on the time field is refused. Conditions and
  // filters may be and/or/not trees (RFC 0029); the budget counts leaves.
  let leaves = 0;
  for (const list of conditionLists(operation)) {
    list.where.forEach((expression, index) => {
      for (const leaf of protocolFilterLeaves(expression, `${list.path}[${index}]`)) {
        leaves += 1;
        const comparison = checkLeaf(leaf, allowed, fail);
        if (comparison !== undefined
          && (comparison.field.includes('.') || filterTarget(dataset, comparison.field) === timeField)) {
          fail(`Step conditions may not use "${comparison.field}"; put the time range in filters.`, leaf.path);
        }
      }
    });
  }
  const isOnAxis = (leaf: ProtocolFilterLeaf) => {
    const comparison = semanticComparisonField(leaf.expression);
    return comparison !== null && timeField !== undefined && filterTarget(dataset, comparison.field) === timeField;
  };
  const filterLeaves = operation.filters.flatMap((expression, index) => (
    protocolFilterLeaves(expression, `$.operation.filters[${index}]`)
  ));
  for (const leaf of filterLeaves) {
    leaves += 1;
    const comparison = checkLeaf(leaf, allowed, fail);
    if (comparison?.operator === 'inDateRange' && !isOnAxis(leaf)) {
      fail(`"inDateRange" applies only to the time field "${timeField ?? ''}".`, leaf.path);
    }
  }
  if (leaves > limits.maxFilters) {
    fail(`At most ${limits.maxFilters} filters and step conditions may be applied together.`, '$.operation');
  }

  // The bounded range must be top-level comparisons on the time field, as a
  // window or filled query's must (RFC 0029): one under "or"/"not" filters
  // events but bounds nothing. A relative range resolves at the executor, so
  // its span is bounded here without a clock.
  const subject = operation.kind === 'funnel' ? 'Funnels' : 'Retention operations';
  const shape = timeField === undefined
    ? { message: `${subject} require a time field.`, path: '$.operation.filters' }
    : timeSeriesRangeViolation(filterLeaves, isOnAxis, timeField, subject);
  const topLevel = filterLeaves.filter(leaf => !leaf.nested && isOnAxis(leaf));
  const relative = topLevel.length === 1 && semanticComparisonField(topLevel[0]!.expression)?.operator === 'inDateRange'
    ? relativeRangeDays((topLevel[0]!.expression as { right?: { value?: unknown } }).right?.value)
    : undefined;
  const timezone = operation.timezone ?? 'UTC';
  const range = shape !== undefined
    ? undefined
    : relative !== undefined
      ? { startMs: RELATIVE_ANCHOR_MS, endMs: RELATIVE_ANCHOR_MS + relative * 86_400_000, timezone }
      : eventTimeRange(topLevel.map(leaf => leaf.expression), () => true, timezone);
  if (range === undefined) {
    fail(
      shape?.message
        ?? `A ${operation.kind} requires exactly one bounded time range on "${timeField}": `
          + 'between, inDateRange, or gt/gte with lt/lte, using ISO timestamps.',
      shape?.path ?? '$.operation.filters',
    );
    return violations;
  }
  if (eventRangeDays(range) > PROTOCOL_EVENT_OPERATION_LIMITS.maxRangeDays) {
    fail(`The time range may span at most ${PROTOCOL_EVENT_OPERATION_LIMITS.maxRangeDays} days.`, '$.operation.filters');
  }
  // A relative range is placed by the executor's clock, so its buckets are
  // counted for the worst placement rather than for the anchored span.
  const buckets = operation.by === undefined
    ? undefined
    : relative !== undefined
      ? estimatePlacementFreeBuckets(relative, operation.by)
      : estimateEventBuckets(range, operation.by);
  const rows = estimatedRows(operation, buckets);
  if (rows > limits.maxRows) {
    fail(
      `This ${operation.kind} could return ${rows} rows; the limit is ${limits.maxRows}. `
      + 'Narrow the time range, use a coarser grain, or lower breakdownLimit.',
      '$.operation',
    );
  }
  return violations;
}
