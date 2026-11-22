import type { ProtocolEventOperation, ProtocolExpression } from '@hypequery/protocol';
import { PROTOCOL_EVENT_OPERATION_LIMITS, parseProtocolEventWindow } from '@hypequery/protocol';
import type { AnyDatasetInstance, MetricFilter } from '../types.js';
import { PortableExecutionUnsupportedError } from '../portable-execution-errors.js';
import { rehydrateMeasureFilter } from './protocol-rehydrate-filters.js';
import { UNSUPPORTED_CONTRACT_REASONS } from './unsupported-contract-reasons.js';

export type EventCohortGrain = 'day' | 'week' | 'month';

/** An RFC 0027 funnel in the dataset layer's vocabulary. */
export interface FunnelSpec {
  readonly kind: 'funnel';
  readonly entity: string;
  readonly steps: readonly { readonly name: string; readonly where: readonly MetricFilter[] }[];
  readonly windowMs: number;
  readonly order: 'strict' | 'any';
  readonly filters: readonly MetricFilter[];
  readonly breakdown: readonly string[];
  readonly breakdownLimit: number;
  readonly by?: EventCohortGrain;
  readonly timezone?: string;
}

export type EventOperationSpec = FunnelSpec;

function filters(expressions: readonly ProtocolExpression[], path: string): MetricFilter[] {
  return expressions.map((expression, index) => rehydrateMeasureFilter(
    expression,
    () => new PortableExecutionUnsupportedError(
      `${path}[${index}] is not a field/operator/value comparison, so it cannot be planned.`,
      { reason: UNSUPPORTED_CONTRACT_REASONS.queryFilterNotComparison },
    ),
  ));
}

/** Enforced constraints (RFC 0019) as the dataset layer's trusted filters. */
export function eventConstraintFilters(expressions: readonly ProtocolExpression[]): MetricFilter[] {
  return filters(expressions, 'constraints');
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
