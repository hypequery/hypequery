/**
 * RFC 0027 event operations (funnel) over an event dataset.
 *
 * Planned as one raw ClickHouse statement over the dataset's scoped source,
 * so tenancy, row policies, enforced constraints and `FINAL` apply exactly as
 * they do to a dataset query. Every caller value is bound as a parameter.
 */

import type { AnyDatasetInstance, ExecutionContext } from './types.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';
import { validateDatasetQueryInput } from './utils/dataset-query-validation.js';
import { queryReadsFinal, withFinalSafety } from './utils/dataset-source.js';
import { renderStatement, type RenderedStatement } from './utils/statement-parameters.js';
import { statementRunner } from './utils/statement-runner.js';
import { resolveTimeAxisRange, isDefinitelyEmptyTimeRange } from './utils/time-axis-bounds.js';
import { isTimeKeyFilter } from './utils/query-timezone.js';
import { filterLeaves } from './utils/filter-tree.js';
import { resolveRelativeDateFilters } from './utils/relative-date-filters.js';
import { buildFunnelSql } from './utils/funnel-sql.js';
import { funnelResultRows, type EventResultRow } from './utils/funnel-rows.js';
import type { EventOperationSpec } from './utils/event-operation-spec.js';
import { eventOperationShapeErrors } from './utils/event-operation-shape.js';

export type { EventOperationSpec, FunnelSpec } from './utils/event-operation-spec.js';
export type { EventResultRow, EventResultValue } from './utils/funnel-rows.js';

export interface PreparedEventOperation {
  readonly statement: RenderedStatement;
  execute(): Promise<EventResultRow[]>;
}

/**
 * Checks an operation against the dataset that serves it. The deployment data
 * plane checks the same rules against the contract first; these run again so
 * the planner never trusts its caller.
 */
export function eventOperationErrors(
  ds: AnyDatasetInstance,
  spec: EventOperationSpec,
  context?: ExecutionContext,
): string[] {
  if (!ds.events) return [`Dataset "${ds.name}" does not declare events.`];
  const shape = eventOperationShapeErrors(spec);
  if (shape.length > 0) return shape;
  const conditions = spec.steps.flatMap(step => step.where);
  const conditionLeaves = filterLeaves(conditions);
  const errors = [...validateDatasetQueryInput(ds, {
    dimensions: [spec.entity, ...spec.breakdown],
    measures: [],
    filters: [...spec.filters, ...conditions],
  }, context).errors];
  for (const name of [spec.entity, ...spec.breakdown]) {
    if (ds.dimensions[name]?.fieldType === 'timestamp') errors.push(`"${name}" is a time dimension and can't be grouped on here.`);
  }
  for (const condition of conditionLeaves) {
    if (condition.field.includes('.') || isTimeKeyFilter(ds, condition.field)) {
      errors.push(`Step conditions may not use "${condition.field}"; put the time range in filters.`);
    }
  }
  // Only top-level comparisons bound the range (RFC 0029): a time comparison
  // under "or" or "not" filters events but bounds nothing.
  const range = resolveTimeAxisRange(ds, [...spec.filters]);
  if (!range) {
    errors.push(`A ${spec.kind} requires exactly one bounded time range on "${ds.timeKey}" as top-level filters: between, inDateRange, or gt/gte with lt/lte, using ISO timestamps.`);
  } else if (isDefinitelyEmptyTimeRange(range)) {
    errors.push('The time range must be non-empty and ordered.');
  }
  return errors;
}

export interface PrepareEventOperationOptions {
  readonly builderFactory: QueryBuilderFactoryLike;
  readonly context?: ExecutionContext;
  /** The clock `inDateRange` filters resolve against (RFC 0029), read once. Defaults to now. */
  readonly now?: () => Date;
}

/**
 * Plan an event operation; `execute()` returns the RFC 0027 result rows.
 * `inDateRange` filters resolve to `gte`/`lt` bounds in the operation's zone
 * first, exactly as a dataset query's do, so a top-level relative range is
 * the bounded range the operation needs.
 */
export function prepareEventOperation(
  ds: AnyDatasetInstance,
  input: EventOperationSpec,
  options: PrepareEventOperationOptions,
): PreparedEventOperation {
  const filters = resolveRelativeDateFilters(ds, [...input.filters], (options.now ?? (() => new Date()))(), input.timezone);
  const spec: EventOperationSpec = filters === undefined || filters === input.filters ? input : { ...input, filters };
  const errors = eventOperationErrors(ds, spec, options.context);
  if (errors.length > 0) throw new Error(`Invalid ${spec.kind}: ${errors.join('; ')}`);
  const planned = buildFunnelSql(ds, spec, options, joinCtx => queryReadsFinal(ds, joinCtx));
  const statement = withFinalSafety(planned.readsFinal, renderStatement(planned.statement));
  const runner = statementRunner(options.builderFactory, { kind: 'raw', statement }, {
    ...(options.context?.abortSignal === undefined ? {} : { abortSignal: options.context.abortSignal }),
  });
  return {
    statement,
    execute: async () => funnelResultRows(spec, planned.breakdown, await runner.execute()),
  };
}
