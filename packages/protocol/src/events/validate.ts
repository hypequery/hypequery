import { ProtocolIdentifierError, parseProtocolQualifiedIdentifier } from '../identifiers/index.js';
import {
  ProtocolDeploymentReleaseError,
  validateProtocolDeploymentReleaseTarget,
} from '../releases/index.js';
import { diagnosticsError, eventError } from './errors.js';
import { resolveQueryEventLimits } from './limits.js';
import type {
  ProtocolQueryDiagnostics,
  ProtocolQueryDiagnosticsErrorCode,
  ProtocolQueryEvent,
  ProtocolQueryEventErrorCode,
  ProtocolQueryEventOptions,
  ProtocolQueryEventTarget,
} from './types.js';

type DataRecord = Record<string, unknown>;

interface Context<C extends string> {
  readonly codes: {
    readonly type: C;
    readonly unknownField: C;
    readonly invalidVersion: C;
    readonly invalidValue: C;
    readonly tooLarge: C;
    readonly unsafeObject: C;
  };
  readonly fail: (code: C, path?: string) => never;
}

const EVENT_CONTEXT: Context<ProtocolQueryEventErrorCode> = {
  codes: {
    type: 'HQ_EVENT_TYPE',
    unknownField: 'HQ_EVENT_UNKNOWN_FIELD',
    invalidVersion: 'HQ_EVENT_INVALID_VERSION',
    invalidValue: 'HQ_EVENT_INVALID_VALUE',
    tooLarge: 'HQ_EVENT_TOO_LARGE',
    unsafeObject: 'HQ_EVENT_UNSAFE_OBJECT',
  },
  fail: eventError,
};

const DIAGNOSTICS_CONTEXT: Context<ProtocolQueryDiagnosticsErrorCode> = {
  codes: {
    type: 'HQ_DIAGNOSTICS_TYPE',
    unknownField: 'HQ_DIAGNOSTICS_UNKNOWN_FIELD',
    invalidVersion: 'HQ_DIAGNOSTICS_INVALID_VERSION',
    invalidValue: 'HQ_DIAGNOSTICS_INVALID_VALUE',
    tooLarge: 'HQ_DIAGNOSTICS_TOO_LARGE',
    unsafeObject: 'HQ_DIAGNOSTICS_UNSAFE_OBJECT',
  },
  fail: diagnosticsError,
};

const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const OCCURRED_AT_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/;
const OPERATIONS = ['query', 'command', 'insert'] as const;
const OUTCOMES = ['success', 'failure'] as const;
const ERROR_CATEGORIES = [
  'input-invalid',
  'unauthenticated',
  'forbidden',
  'tenant-required',
  'not-found',
  'too-large',
  'aborted',
  'deadline-exceeded',
  'unavailable',
  'internal',
] as const;
const TERMINAL_REASONS = ['completed', 'aborted', 'deadline-exceeded', 'drained'] as const;
const MAX_DURATION_MS = 86_400_000;
const MAX_ROW_COUNT = 1_000_000_000_000;
const MAX_ATTEMPTS = 64;
const textEncoder = new TextEncoder();

function requireRecord<C extends string>(
  context: Context<C>,
  input: unknown,
  path: string,
): DataRecord {
  const { codes, fail } = context;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(codes.type, path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(codes.unsafeObject, path);
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    fail(codes.unsafeObject, path);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail(codes.unsafeObject, path);
    }
  }
  return input as DataRecord;
}

function exactFields<C extends string>(
  context: Context<C>,
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const { codes, fail } = context;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(codes.unknownField, `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(codes.type, `${path}.${key}`);
  }
}

function freezeRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function requireString<C extends string>(
  context: Context<C>,
  value: unknown,
  path: string,
): string {
  if (typeof value !== 'string') context.fail(context.codes.type, path);
  return value;
}

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function boundedText<C extends string>(
  context: Context<C>,
  value: unknown,
  path: string,
  maximum: number,
): string {
  const text = requireString(context, value, path);
  if (text.length > maximum || textEncoder.encode(text).byteLength > maximum) {
    context.fail(context.codes.tooLarge, path);
  }
  if (hasControlCharacter(text)) {
    context.fail(context.codes.invalidValue, path);
  }
  return text;
}

function hexIdentity<C extends string>(
  context: Context<C>,
  value: unknown,
  path: string,
): string {
  const text = requireString(context, value, path);
  if (!HEX64_PATTERN.test(text)) context.fail(context.codes.invalidValue, path);
  return text;
}

function occurredAt<C extends string>(
  context: Context<C>,
  value: unknown,
  path: string,
): string {
  const text = requireString(context, value, path);
  if (!OCCURRED_AT_PATTERN.test(text) || Number.isNaN(Date.parse(text))) {
    context.fail(context.codes.invalidValue, path);
  }
  return text;
}

function boundedCount<C extends string>(
  context: Context<C>,
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number') context.fail(context.codes.type, path);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    context.fail(context.codes.invalidValue, path);
  }
  return value;
}

function stringChoice<C extends string, T extends string>(
  context: Context<C>,
  value: unknown,
  path: string,
  choices: readonly T[],
): T {
  const text = requireString(context, value, path);
  if (!choices.includes(text as T)) context.fail(context.codes.invalidValue, path);
  return text as T;
}

function queryTarget<C extends string>(
  context: Context<C>,
  value: unknown,
  path: string,
): ProtocolQueryEventTarget {
  try {
    return validateProtocolDeploymentReleaseTarget(value);
  } catch (error) {
    if (error instanceof ProtocolDeploymentReleaseError) {
      context.fail(context.codes.invalidValue, path);
    }
    throw error;
  }
}

function queryName<C extends string>(
  context: Context<C>,
  value: unknown,
  path: string,
): string {
  const text = requireString(context, value, path);
  try {
    parseProtocolQualifiedIdentifier(text);
  } catch (error) {
    if (error instanceof ProtocolIdentifierError) {
      context.fail(context.codes.invalidValue, path);
    }
    throw error;
  }
  return text;
}

function kindAndVersion<C extends string>(
  context: Context<C>,
  value: DataRecord,
  kind: string,
): void {
  const { codes, fail } = context;
  if (value.kind !== kind) {
    if (typeof value.kind !== 'string') fail(codes.type, '$.kind');
    fail(codes.invalidValue, '$.kind');
  }
  if (value.version !== 1) {
    if (typeof value.version !== 'number') fail(codes.type, '$.version');
    fail(codes.invalidVersion, '$.version');
  }
}

export function validateProtocolQueryEvent(
  input: unknown,
  options: ProtocolQueryEventOptions = {},
): ProtocolQueryEvent {
  const limits = resolveQueryEventLimits(options);
  const context = EVENT_CONTEXT;
  const value = requireRecord(context, input, '$');
  exactFields(
    context,
    value,
    [
      'kind',
      'version',
      'eventId',
      'occurredAt',
      'target',
      'queryName',
      'operation',
      'outcome',
      'durationMs',
    ],
    ['errorCategory', 'rowCount', 'tenantFingerprint', 'correlationId'],
    '$',
  );
  kindAndVersion(context, value, 'hypequery-query-event');
  const outcome = stringChoice(context, value.outcome, '$.outcome', OUTCOMES);
  const hasCategory = Object.hasOwn(value, 'errorCategory');
  if (outcome === 'failure' && !hasCategory) {
    eventError('HQ_EVENT_INVALID_VALUE', '$.errorCategory');
  }
  if (outcome === 'success' && hasCategory) {
    eventError('HQ_EVENT_INVALID_VALUE', '$.errorCategory');
  }
  return freezeRecord({
    kind: 'hypequery-query-event',
    version: 1,
    eventId: hexIdentity(context, value.eventId, '$.eventId'),
    occurredAt: occurredAt(context, value.occurredAt, '$.occurredAt'),
    target: queryTarget(context, value.target, '$.target'),
    queryName: queryName(context, value.queryName, '$.queryName'),
    operation: stringChoice(context, value.operation, '$.operation', OPERATIONS),
    outcome,
    ...(hasCategory ? {
      errorCategory: stringChoice(
        context, value.errorCategory, '$.errorCategory', ERROR_CATEGORIES,
      ),
    } : {}),
    durationMs: boundedCount(context, value.durationMs, '$.durationMs', 0, MAX_DURATION_MS),
    ...(Object.hasOwn(value, 'rowCount') ? {
      rowCount: boundedCount(context, value.rowCount, '$.rowCount', 0, MAX_ROW_COUNT),
    } : {}),
    ...(Object.hasOwn(value, 'tenantFingerprint') ? {
      tenantFingerprint: hexIdentity(context, value.tenantFingerprint, '$.tenantFingerprint'),
    } : {}),
    ...(Object.hasOwn(value, 'correlationId') ? {
      correlationId: boundedText(context, value.correlationId, '$.correlationId', limits.maxStringBytes),
    } : {}),
  }) as unknown as ProtocolQueryEvent;
}

export function validateProtocolQueryDiagnostics(
  input: unknown,
  options: ProtocolQueryEventOptions = {},
): ProtocolQueryDiagnostics {
  const limits = resolveQueryEventLimits(options);
  const context = DIAGNOSTICS_CONTEXT;
  const value = requireRecord(context, input, '$');
  exactFields(
    context,
    value,
    ['kind', 'version', 'eventId', 'queryId', 'terminalReason', 'attempts'],
    ['runtimeIdentity', 'debugQuery', 'safeMessage'],
    '$',
  );
  kindAndVersion(context, value, 'hypequery-query-diagnostics');
  return freezeRecord({
    kind: 'hypequery-query-diagnostics',
    version: 1,
    eventId: hexIdentity(context, value.eventId, '$.eventId'),
    queryId: hexIdentity(context, value.queryId, '$.queryId'),
    terminalReason: stringChoice(
      context, value.terminalReason, '$.terminalReason', TERMINAL_REASONS,
    ),
    attempts: boundedCount(context, value.attempts, '$.attempts', 1, MAX_ATTEMPTS),
    ...(Object.hasOwn(value, 'runtimeIdentity') ? {
      runtimeIdentity: hexIdentity(context, value.runtimeIdentity, '$.runtimeIdentity'),
    } : {}),
    ...(Object.hasOwn(value, 'debugQuery') ? {
      debugQuery: boundedText(context, value.debugQuery, '$.debugQuery', limits.maxDebugBytes),
    } : {}),
    ...(Object.hasOwn(value, 'safeMessage') ? {
      safeMessage: boundedText(context, value.safeMessage, '$.safeMessage', limits.maxStringBytes),
    } : {}),
  }) as unknown as ProtocolQueryDiagnostics;
}
