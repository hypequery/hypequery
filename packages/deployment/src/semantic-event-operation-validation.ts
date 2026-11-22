/**
 * Contract-driven validation of RFC 0027 event operations (funnel, retention).
 *
 * The protocol validator already checked syntax, closed records and
 * structural limits. What remains depends on the contract and the caller:
 * whether the dataset declares events, whether every field exists and may be
 * used by this principal, the bounded time range, and the row budget.
 */

import {
  PROTOCOL_EVENT_OPERATION_LIMITS,
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
import {
  estimateEventBuckets,
  eventRangeDays,
  eventTimeRange,
  type EventTimeRange,
} from './utils/event-time-range.js';

export interface SemanticEventOperationLimits {
  /** Largest row count the result may have after every ceiling is applied. */
  readonly maxRows: number;
  /** Filters plus every condition, after enforced constraints are counted. */
  readonly maxFilters: number;
}

function isTimeDimension(dataset: ProtocolDeploymentDatasetAnyVersion, name: string): boolean {
  return dataset.dimensions.some(dimension => String(dimension.name) === name && dimension.type === 'timestamp');
}

/** The dimension a filter name addresses: a declared alias's field, or the name itself. */
function filterTarget(dataset: ProtocolDeploymentDatasetAnyVersion, name: string): string {
  const declared = protocolFilterCapabilities(dataset).named.get(name);
  return declared === undefined ? name : String(declared.field);
}

function checkPredicate(
  expression: ProtocolExpression,
  path: string,
  allowed: SemanticAllowedFields,
  fail: (message: string, path: string) => void,
): string | undefined {
  const comparison = semanticComparisonField(expression);
  if (comparison === null) {
    fail('Only a field/operator/value comparison may be filtered on.', path);
    return undefined;
  }
  const operators = allowed.filters.get(comparison.field);
  if (operators === undefined) {
    fail(`Unknown or unfilterable field "${comparison.field}".`, path);
    return undefined;
  }
  if (!operators.has(comparison.operator)) {
    fail(`Operator "${comparison.operator}" is not allowed on "${comparison.field}".`, `${path}.operator`);
  }
  return comparison.field;
}

/** The condition lists an operation tests events against. */
function conditionLists(operation: ProtocolEventOperation): { path: string; where: readonly ProtocolExpression[] }[] {
  if (operation.kind === 'retention') {
    return [
      { path: '$.operation.start.where', where: operation.start.where },
      { path: '$.operation.return.where', where: operation.return.where },
    ];
  }
  return operation.steps.map((step, index) => ({ path: `$.operation.steps[${index}].where`, where: step.where }));
}

/**
 * Rows the operation can return, before execution, from its range and
 * options: cohorts × steps (funnel) or cohorts × periods (retention), per
 * breakdown group.
 */
function estimatedRows(operation: ProtocolEventOperation, range: EventTimeRange): number {
  const groups = operation.breakdown === undefined
    ? 1
    : operation.breakdownLimit ?? PROTOCOL_EVENT_OPERATION_LIMITS.defaultBreakdownLimit;
  if (operation.kind === 'retention') {
    return estimateEventBuckets(range, operation.grain) * operation.periods * groups;
  }
  const buckets = operation.by === undefined ? 1 : estimateEventBuckets(range, operation.by);
  return buckets * groups * operation.steps.length;
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
  (operation.breakdown ?? []).forEach((name, index) => {
    if (!groupable(String(name))) {
      fail(`Unknown or non-groupable dimension "${String(name)}".`, `$.operation.breakdown[${index}]`);
    }
  });

  // Conditions select which events count as a step; the time range belongs
  // in `filters`, so a condition on the time field is refused.
  let conditions = 0;
  for (const list of conditionLists(operation)) {
    conditions += list.where.length;
    list.where.forEach((expression, index) => {
      const path = `${list.path}[${index}]`;
      const field = checkPredicate(expression, path, allowed, fail);
      if (field !== undefined && (field.includes('.') || filterTarget(dataset, field) === timeField)) {
        fail(`Conditions may not use "${field}"; put the time range in filters.`, path);
      }
    });
  }
  operation.filters.forEach((expression, index) => {
    checkPredicate(expression, `$.operation.filters[${index}]`, allowed, fail);
  });
  if (operation.filters.length + conditions > limits.maxFilters) {
    fail(`At most ${limits.maxFilters} filters and conditions may be applied together.`, '$.operation');
  }

  const range = timeField === undefined
    ? undefined
    : eventTimeRange(operation.filters, name => filterTarget(dataset, name) === timeField);
  if (range === undefined) {
    fail(
      `A ${operation.kind} requires exactly one bounded time range on "${timeField ?? 'the time field'}": `
      + 'between, or gt/gte with lt/lte, using ISO timestamps.',
      '$.operation.filters',
    );
    return violations;
  }
  if (eventRangeDays(range) > PROTOCOL_EVENT_OPERATION_LIMITS.maxRangeDays) {
    fail(`The time range may span at most ${PROTOCOL_EVENT_OPERATION_LIMITS.maxRangeDays} days.`, '$.operation.filters');
  }
  const rows = estimatedRows(operation, range);
  if (rows > limits.maxRows) {
    fail(
      `This ${operation.kind} could return ${rows} rows; the limit is ${limits.maxRows}. `
      + 'Narrow the time range, use a coarser grain, or lower breakdownLimit.',
      '$.operation',
    );
  }
  return violations;
}
