import type { ProtocolEventOperation, ProtocolExpression } from '@hypequery/protocol';
import { PROTOCOL_EVENT_OPERATION_LIMITS, parseProtocolEventWindow } from '@hypequery/protocol';
import type { AnyDatasetInstance, DatasetFilterNode, MetricFilter } from '../types.js';
import { PortableExecutionUnsupportedError } from '../portable-execution-errors.js';
import { rehydrateMeasureFilter } from './protocol-rehydrate-filters.js';
import { UNSUPPORTED_CONTRACT_REASONS } from './unsupported-contract-reasons.js';

export type EventCohortGrain = 'day' | 'week' | 'month';

/** An RFC 0027 funnel in the dataset layer's vocabulary. */
export interface FunnelSpec {
  readonly kind: 'funnel';
  readonly entity: string;
  /** Each step's conditions: comparisons or and/or/not groups (RFC 0029), ANDed. */
  readonly steps: readonly { readonly name: string; readonly where: readonly DatasetFilterNode[] }[];
  readonly windowMs: number;
  readonly order: 'strict' | 'any';
  /** Caller filters, ANDed; groups and `inDateRange` as a dataset query takes them. */
  readonly filters: readonly DatasetFilterNode[];
  readonly breakdown: readonly string[];
  readonly breakdownLimit: number;
  readonly by?: EventCohortGrain;
  readonly timezone?: string;
}

export type EventOperationSpec = FunnelSpec;

function comparison(expression: ProtocolExpression, path: string): MetricFilter {
  return rehydrateMeasureFilter(
    expression,
    () => new PortableExecutionUnsupportedError(
      `${path} is not a field/operator/value comparison, so it cannot be planned.`,
      { reason: UNSUPPORTED_CONTRACT_REASONS.queryFilterNotComparison },
    ),
  );
}

/** A predicate as a filter node: `logical` becomes an and/or/not group (RFC 0029). */
function filterNode(expression: ProtocolExpression, path: string): DatasetFilterNode {
  if (expression.kind !== 'logical') return comparison(expression, path);
  if (expression.operator === 'not') return { not: filterNode(expression.operand, `${path}.operand`) };
  const items = expression.operands.map((operand, index) => filterNode(operand, `${path}.operands[${index}]`));
  return expression.operator === 'and' ? { and: items } : { or: items };
}

function filters(expressions: readonly ProtocolExpression[], path: string): DatasetFilterNode[] {
  return expressions.map((expression, index) => filterNode(expression, `${path}[${index}]`));
}

/** Enforced constraints (RFC 0019) as the dataset layer's trusted filters: comparisons only. */
export function eventConstraintFilters(expressions: readonly ProtocolExpression[]): MetricFilter[] {
  return expressions.map((expression, index) => comparison(expression, `constraints[${index}]`));
}

/** Resolve a validated protocol operation against the dataset that serves it. */
export function eventOperationSpec(operation: ProtocolEventOperation, dataset: AnyDatasetInstance): EventOperationSpec {
  if (!dataset.events) {
    throw new Error(`Dataset "${dataset.name}" does not declare events, so it has no ${operation.kind}.`);
  }
  const window = parseProtocolEventWindow(operation.window);
  if (!window) throw new Error(`Invalid funnel window "${operation.window}".`);
  return {
    kind: 'funnel',
    entity: String(operation.entity ?? dataset.events.entity),
    steps: operation.steps.map((step, index) => ({
      name: String(step.name),
      where: filters(step.where, `steps[${index}].where`),
    })),
    windowMs: window.milliseconds,
    order: operation.order ?? 'strict',
    filters: filters(operation.filters, 'filters'),
    breakdown: (operation.breakdown ?? []).map(String),
    breakdownLimit: operation.breakdownLimit ?? PROTOCOL_EVENT_OPERATION_LIMITS.defaultBreakdownLimit,
    ...(operation.by === undefined ? {} : { by: operation.by }),
    ...(operation.timezone === undefined ? {} : { timezone: operation.timezone }),
  };
}
