import { CLIENT_TIMEZONE_NAMES } from '../client-contract/timezone-names.js';
import { ProtocolExpressionError, validateProtocolExpression } from '../expressions/index.js';
import { expressionError } from '../expressions/errors.js';
import type { ProtocolExpression } from '../expressions/index.js';
import { ProtocolIdentifierError, parseProtocolIdentifier } from '../identifiers/index.js';
import {
  PROTOCOL_EVENT_OPERATION_LIMITS as LIMITS,
  PROTOCOL_FUNNEL_COLUMNS,
  PROTOCOL_RETENTION_COLUMNS,
} from './limits.js';
import { isProtocolPredicate } from './predicates.js';
import { exactFields, freezeRecord, requireArray, requireRecord, type DataRecord } from './records.js';
import { parseProtocolEventWindow } from './window.js';
import type { ProtocolEventOperation, ProtocolEventOperationKind } from './types.js';

const COHORT_GRAINS: ReadonlySet<string> = new Set(['day', 'week', 'month']);
const KINDS: ReadonlySet<string> = new Set<ProtocolEventOperationKind>(['funnel', 'retention']);
const COMMON_OPTIONAL = ['entity', 'breakdown', 'breakdownLimit', 'timezone'] as const;
/** Predicates per filter list; a time range plus ordinary filters. */
const MAX_FILTERS = 100;

/** True when `kind` names an RFC 0027 operation rather than an RFC 0003 query. */
export function isProtocolEventOperationKind(kind: unknown): kind is ProtocolEventOperationKind {
  return typeof kind === 'string' && KINDS.has(kind);
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string') expressionError('HQ_EXPRESSION_TYPE', path);
  try {
    return parseProtocolIdentifier(value);
  } catch (error) {
    if (error instanceof ProtocolIdentifierError) expressionError('HQ_EXPRESSION_INVALID_IDENTIFIER', path);
    throw error;
  }
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number') expressionError('HQ_EXPRESSION_TYPE', path);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    expressionError('HQ_EXPRESSION_INVALID_QUERY', path);
  }
  return value;
}

/** An RFC 0003 predicate, with failures reported at its place in the operation. */
function predicate(input: unknown, path: string): ProtocolExpression {
  let expression: ProtocolExpression;
  try {
    expression = validateProtocolExpression(input);
  } catch (error) {
    if (error instanceof ProtocolExpressionError) {
      expressionError(error.code, `${path}${error.path.slice(1)}`);
    }
    throw error;
  }
  if (!isProtocolPredicate(expression)) expressionError('HQ_EXPRESSION_INVALID_QUERY', path);
  return expression;
}

function predicates(input: unknown, path: string, minimum: number, maximum: number): readonly ProtocolExpression[] {
  const values = requireArray(input, path, maximum);
  if (values.length < minimum) expressionError('HQ_EXPRESSION_INVALID_QUERY', path);
  return Object.freeze(values.map((item, index) => predicate(item, `${path}[${index}]`)));
}

/** A `{ where }` condition list: 1–10 AND-combined predicates. */
function conditions(input: unknown, path: string): readonly ProtocolExpression[] {
  return predicates(input, path, 1, LIMITS.maxConditions);
}

function common(value: DataRecord, result: DataRecord, reserved: ReadonlySet<string>): void {
  result.dataset = identifier(value.dataset, '$.dataset');
  if (value.entity !== undefined) result.entity = identifier(value.entity, '$.entity');
  // Every operation needs a time range, so `filters` can never be empty.
  result.filters = predicates(value.filters, '$.filters', 1, MAX_FILTERS);
  if (value.breakdown !== undefined) {
    const names = requireArray(value.breakdown, '$.breakdown', LIMITS.maxBreakdown);
    if (names.length === 0) expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.breakdown');
    const seen = new Set<string>();
    result.breakdown = Object.freeze(names.map((item, index) => {
      const path = `$.breakdown[${index}]`;
      const name = identifier(item, path);
      // A row can't carry two values under one key.
      if (seen.has(name) || reserved.has(name)) expressionError('HQ_EXPRESSION_INVALID_QUERY', path);
      seen.add(name);
      return name;
    }));
  }
  if (value.breakdownLimit !== undefined) {
    if (value.breakdown === undefined) expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.breakdownLimit');
    result.breakdownLimit = boundedInteger(value.breakdownLimit, '$.breakdownLimit', 1, LIMITS.maxBreakdownLimit);
  }
  if (value.timezone !== undefined) {
    if (typeof value.timezone !== 'string') expressionError('HQ_EXPRESSION_TYPE', '$.timezone');
    if (!CLIENT_TIMEZONE_NAMES.has(value.timezone)) expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.timezone');
    result.timezone = value.timezone;
  }
}

function cohortGrain(value: unknown, path: string): string {
  if (typeof value !== 'string') expressionError('HQ_EXPRESSION_TYPE', path);
  if (!COHORT_GRAINS.has(value)) expressionError('HQ_EXPRESSION_INVALID_QUERY', path);
  return value;
}

function funnel(value: DataRecord): DataRecord {
  exactFields(value, ['kind', 'dataset', 'steps', 'window', 'filters'], [...COMMON_OPTIONAL, 'order', 'by'], '$');
  const result: DataRecord = { kind: 'funnel' };
  const steps = requireArray(value.steps, '$.steps', LIMITS.maxSteps);
  if (steps.length < LIMITS.minSteps) expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.steps');
  const names = new Set<string>();
  const validatedSteps = Object.freeze(steps.map((item, index) => {
    const path = `$.steps[${index}]`;
    const step = requireRecord(item, path);
    exactFields(step, ['name', 'where'], [], path);
    const name = identifier(step.name, `${path}.name`);
    if (names.has(name)) expressionError('HQ_EXPRESSION_INVALID_QUERY', `${path}.name`);
    names.add(name);
    return freezeRecord({ name, where: conditions(step.where, `${path}.where`) });
  }));
  if (typeof value.window !== 'string') expressionError('HQ_EXPRESSION_TYPE', '$.window');
  const window = parseProtocolEventWindow(value.window);
  if (!window || window.milliseconds > LIMITS.maxWindowMilliseconds) {
    expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.window');
  }
  // Document order: kind, dataset, entity, steps, window, order, filters, …
  const shared: DataRecord = {};
  common(value, shared, PROTOCOL_FUNNEL_COLUMNS);
  result.dataset = shared.dataset;
  if (shared.entity !== undefined) result.entity = shared.entity;
  result.steps = validatedSteps;
  result.window = value.window;
  if (value.order !== undefined) {
    if (typeof value.order !== 'string') expressionError('HQ_EXPRESSION_TYPE', '$.order');
    if (value.order !== 'strict' && value.order !== 'any') expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.order');
    result.order = value.order;
  }
  result.filters = shared.filters;
  if (shared.breakdown !== undefined) result.breakdown = shared.breakdown;
  if (shared.breakdownLimit !== undefined) result.breakdownLimit = shared.breakdownLimit;
  if (value.by !== undefined) result.by = cohortGrain(value.by, '$.by');
  if (shared.timezone !== undefined) result.timezone = shared.timezone;
  return result;
}

/** A `{ where }` record: what starts a cohort, or what counts as a return. */
function condition(input: unknown, path: string): DataRecord {
  const value = requireRecord(input, path);
  exactFields(value, ['where'], [], path);
  return freezeRecord({ where: conditions(value.where, `${path}.where`) });
}

function retention(value: DataRecord): DataRecord {
  exactFields(value, ['kind', 'dataset', 'start', 'return', 'grain', 'periods', 'filters'], COMMON_OPTIONAL, '$');
  const start = condition(value.start, '$.start');
  const returning = condition(value.return, '$.return');
  const grain = cohortGrain(value.grain, '$.grain');
  const periods = boundedInteger(value.periods, '$.periods', 1, LIMITS.maxPeriods);
  const shared: DataRecord = {};
  common(value, shared, PROTOCOL_RETENTION_COLUMNS);
  // Document order: kind, dataset, entity, start, return, grain, periods, filters, …
  return {
    kind: 'retention',
    dataset: shared.dataset,
    ...(shared.entity === undefined ? {} : { entity: shared.entity }),
    start,
    return: returning,
    grain,
    periods,
    filters: shared.filters,
    ...(shared.breakdown === undefined ? {} : { breakdown: shared.breakdown }),
    ...(shared.breakdownLimit === undefined ? {} : { breakdownLimit: shared.breakdownLimit }),
    ...(shared.timezone === undefined ? {} : { timezone: shared.timezone }),
  };
}

/**
 * Validate an RFC 0027 operation: syntax, closed records, limits and output
 * names. Whether the dataset declares events, whether each field exists and
 * may be used, and the time-range rule depend on the deployment contract and
 * the caller, so the data plane checks those.
 */
export function validateProtocolEventOperation(input: unknown): ProtocolEventOperation {
  const value = requireRecord(input, '$');
  if (!Object.hasOwn(value, 'kind')) expressionError('HQ_EXPRESSION_TYPE', '$.kind');
  if (typeof value.kind !== 'string') expressionError('HQ_EXPRESSION_TYPE', '$.kind');
  switch (value.kind) {
    case 'funnel':
      return freezeRecord(funnel(value)) as unknown as ProtocolEventOperation;
    case 'retention':
      return freezeRecord(retention(value)) as unknown as ProtocolEventOperation;
    default:
      return expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.kind');
  }
}
