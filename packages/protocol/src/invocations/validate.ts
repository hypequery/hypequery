import { ProtocolExpressionError, validateProtocolSemanticQuery } from '../expressions/index.js';
import {
  ProtocolDeploymentReleaseError,
  validateProtocolDeploymentReleaseTarget,
} from '../releases/index.js';
import { invocationError } from './errors.js';
import { resolveSemanticInvocationLimits } from './limits.js';
import type {
  ProtocolSemanticInvocation,
  ProtocolSemanticInvocationBudget,
  ProtocolSemanticInvocationFailure,
  ProtocolSemanticInvocationLimits,
  ProtocolSemanticInvocationMeta,
  ProtocolSemanticInvocationOptions,
  ProtocolSemanticInvocationResult,
  ProtocolSemanticInvocationRow,
  ProtocolSemanticInvocationTarget,
} from './types.js';

type DataRecord = Record<string, unknown>;
type Limits = Readonly<ProtocolSemanticInvocationLimits>;

const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const FAILURE_CATEGORIES = [
  'configuration-invalid',
  'not-found',
  'unauthenticated',
  'forbidden',
  'tenant-required',
  'input-invalid',
  'budget-exceeded',
  'cancelled',
  'stale-activation',
  'unsupported-capability',
  'executor-unavailable',
  'executor-failed',
  'output-invalid',
] as const;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const textEncoder = new TextEncoder();

function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    invocationError('HQ_INVOCATION_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    invocationError('HQ_INVOCATION_UNSAFE_OBJECT', path);
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    invocationError('HQ_INVOCATION_UNSAFE_OBJECT', path);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      invocationError('HQ_INVOCATION_UNSAFE_OBJECT', path);
    }
  }
  return input as DataRecord;
}

function requireArray(input: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(input)) invocationError('HQ_INVOCATION_TYPE', path);
  if (input.length > maximum) invocationError('HQ_INVOCATION_TOO_MANY_ITEMS', path);
  // A sparse array or one carrying extra own properties is not portable JSON.
  if (Object.keys(input).length !== input.length) {
    invocationError('HQ_INVOCATION_UNSAFE_OBJECT', path);
  }
  return input;
}

function exactFields(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invocationError('HQ_INVOCATION_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) invocationError('HQ_INVOCATION_TYPE', `${path}.${key}`);
  }
}

function freezeRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function boundedText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string') invocationError('HQ_INVOCATION_TYPE', path);
  if (value.length > maximum || textEncoder.encode(value).byteLength > maximum) {
    invocationError('HQ_INVOCATION_TOO_LARGE', path);
  }
  if (hasControlCharacter(value)) invocationError('HQ_INVOCATION_INVALID_VALUE', path);
  return value;
}

function boundedInteger(value: unknown, path: string, maximum: number): number {
  if (typeof value !== 'number') invocationError('HQ_INVOCATION_TYPE', path);
  if (!Number.isSafeInteger(value) || value < 1) {
    invocationError('HQ_INVOCATION_INVALID_VALUE', path);
  }
  if (value > maximum) invocationError('HQ_INVOCATION_TOO_LARGE', path);
  return value;
}

function nonNegativeInteger(value: unknown, path: string, maximum: number): number {
  if (typeof value !== 'number') invocationError('HQ_INVOCATION_TYPE', path);
  if (!Number.isSafeInteger(value) || value < 0) {
    invocationError('HQ_INVOCATION_INVALID_VALUE', path);
  }
  if (value > maximum) invocationError('HQ_INVOCATION_TOO_LARGE', path);
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invocationError('HQ_INVOCATION_TYPE', path);
  return value;
}

function activationRevision(value: unknown, path: string): string {
  if (typeof value !== 'string') invocationError('HQ_INVOCATION_TYPE', path);
  if (!HEX64_PATTERN.test(value)) invocationError('HQ_INVOCATION_INVALID_VALUE', path);
  return value;
}

function requireVersion(value: DataRecord, kind: string, path: string): void {
  if (value.kind !== kind) {
    if (typeof value.kind !== 'string') invocationError('HQ_INVOCATION_TYPE', `${path}.kind`);
    invocationError('HQ_INVOCATION_INVALID_VALUE', `${path}.kind`);
  }
  if (value.version !== 1) {
    if (typeof value.version !== 'number') invocationError('HQ_INVOCATION_TYPE', `${path}.version`);
    invocationError('HQ_INVOCATION_INVALID_VERSION', `${path}.version`);
  }
}

function target(input: unknown, path: string): ProtocolSemanticInvocationTarget {
  try {
    return validateProtocolDeploymentReleaseTarget(input);
  } catch (error) {
    if (error instanceof ProtocolDeploymentReleaseError) {
      invocationError('HQ_INVOCATION_INVALID_VALUE', path);
    }
    throw error;
  }
}

function budget(input: unknown, path: string, limits: Limits): ProtocolSemanticInvocationBudget {
  const value = requireRecord(input, path);
  exactFields(value, [], ['deadlineMs', 'maxRows', 'maxResponseBytes'], path);
  const result: Record<string, number> = {};
  if (value.deadlineMs !== undefined) {
    result.deadlineMs = boundedInteger(value.deadlineMs, `${path}.deadlineMs`, limits.maxDeadlineMs);
  }
  if (value.maxRows !== undefined) {
    result.maxRows = boundedInteger(value.maxRows, `${path}.maxRows`, limits.maxRows);
  }
  if (value.maxResponseBytes !== undefined) {
    result.maxResponseBytes = boundedInteger(
      value.maxResponseBytes,
      `${path}.maxResponseBytes`,
      limits.maxResponseBytes,
    );
  }
  // An empty budget is indistinguishable from omitting the field, and two
  // encodings of the same request are not portable.
  if (Object.keys(result).length === 0) invocationError('HQ_INVOCATION_INVALID_VALUE', path);
  return freezeRecord(result) as unknown as ProtocolSemanticInvocationBudget;
}

/** Validate one dataset or metric invocation request. */
export function validateProtocolSemanticInvocation(
  input: unknown,
  options: ProtocolSemanticInvocationOptions = {},
): ProtocolSemanticInvocation {
  const limits = resolveSemanticInvocationLimits(options);
  const value = requireRecord(input, '$');
  exactFields(
    value,
    ['kind', 'version', 'target', 'operation'],
    ['activationRevision', 'budget', 'correlationId'],
    '$',
  );
  requireVersion(value, 'hypequery-semantic-invocation', '$');

  const result: Record<string, unknown> = {
    kind: 'hypequery-semantic-invocation',
    version: 1,
    target: target(value.target, '$.target'),
    operation: semanticQuery(value.operation, '$.operation'),
  };
  if (value.activationRevision !== undefined) {
    result.activationRevision = activationRevision(
      value.activationRevision,
      '$.activationRevision',
    );
  }
  if (value.budget !== undefined) result.budget = budget(value.budget, '$.budget', limits);
  if (value.correlationId !== undefined) {
    result.correlationId = boundedText(
      value.correlationId,
      '$.correlationId',
      limits.maxTextBytes,
    );
  }
  return freezeRecord(result) as unknown as ProtocolSemanticInvocation;
}

function semanticQuery(input: unknown, path: string) {
  try {
    return validateProtocolSemanticQuery(input);
  } catch (error) {
    if (error instanceof ProtocolExpressionError) {
      invocationError('HQ_INVOCATION_INVALID_VALUE', path);
    }
    throw error;
  }
}

function row(input: unknown, path: string, limits: Limits): ProtocolSemanticInvocationRow {
  const value = requireRecord(input, path);
  const keys = Object.keys(value);
  if (keys.length > limits.maxColumnsPerRow) {
    invocationError('HQ_INVOCATION_TOO_MANY_ITEMS', path);
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const cell = value[key];
    const cellPath = `${path}.${key}`;
    if (cell === null || typeof cell === 'boolean') {
      result[key] = cell;
    } else if (typeof cell === 'number') {
      // A non-finite number has no portable JSON encoding.
      if (!Number.isFinite(cell)) invocationError('HQ_INVOCATION_INVALID_VALUE', cellPath);
      result[key] = cell;
    } else if (typeof cell === 'string') {
      if (textEncoder.encode(cell).byteLength > limits.maxValueBytes) {
        invocationError('HQ_INVOCATION_TOO_LARGE', cellPath);
      }
      result[key] = cell;
    } else {
      invocationError('HQ_INVOCATION_TYPE', cellPath);
    }
  }
  return freezeRecord(result) as unknown as ProtocolSemanticInvocationRow;
}

function meta(
  input: unknown,
  path: string,
  limits: Limits,
  rowCount: number,
): ProtocolSemanticInvocationMeta {
  const value = requireRecord(input, path);
  exactFields(value, ['rowCount'], ['pagination'], path);
  const declared = nonNegativeInteger(value.rowCount, `${path}.rowCount`, limits.maxRows);
  // A rowCount that disagrees with the rows it describes is a broken result,
  // not a hint — the caller would page or aggregate on a false total.
  if (declared !== rowCount) invocationError('HQ_INVOCATION_INVALID_VALUE', `${path}.rowCount`);

  const result: Record<string, unknown> = { rowCount: declared };
  if (value.pagination !== undefined) {
    const paginationPath = `${path}.pagination`;
    const pagination = requireRecord(value.pagination, paginationPath);
    exactFields(pagination, ['limit', 'offset', 'hasMore'], [], paginationPath);
    result.pagination = freezeRecord({
      limit: boundedInteger(pagination.limit, `${paginationPath}.limit`, limits.maxRows),
      offset: nonNegativeInteger(
        pagination.offset,
        `${paginationPath}.offset`,
        Number.MAX_SAFE_INTEGER,
      ),
      hasMore: requireBoolean(pagination.hasMore, `${paginationPath}.hasMore`),
    });
  }
  return freezeRecord(result) as unknown as ProtocolSemanticInvocationMeta;
}

/** Validate a successful invocation result before it is returned or cached. */
export function validateProtocolSemanticInvocationResult(
  input: unknown,
  options: ProtocolSemanticInvocationOptions = {},
): ProtocolSemanticInvocationResult {
  const limits = resolveSemanticInvocationLimits(options);
  const value = requireRecord(input, '$');
  exactFields(value, ['kind', 'version', 'activationRevision', 'data', 'meta'], [], '$');
  requireVersion(value, 'hypequery-semantic-invocation-result', '$');

  const rows = requireArray(value.data, '$.data', limits.maxRows);
  const data = Object.freeze(
    rows.map((entry, index) => row(entry, `$.data[${index}]`, limits)),
  );
  return freezeRecord({
    kind: 'hypequery-semantic-invocation-result',
    version: 1,
    activationRevision: activationRevision(value.activationRevision, '$.activationRevision'),
    data,
    meta: meta(value.meta, '$.meta', limits, data.length),
  }) as unknown as ProtocolSemanticInvocationResult;
}

/** Validate a failed invocation before it crosses a trust boundary. */
export function validateProtocolSemanticInvocationFailure(
  input: unknown,
  options: ProtocolSemanticInvocationOptions = {},
): ProtocolSemanticInvocationFailure {
  const limits = resolveSemanticInvocationLimits(options);
  const value = requireRecord(input, '$');
  exactFields(
    value,
    ['kind', 'version', 'category', 'code', 'message', 'retryable', 'relist'],
    ['path', 'activationRevision'],
    '$',
  );
  requireVersion(value, 'hypequery-semantic-invocation-failure', '$');

  if (typeof value.category !== 'string') invocationError('HQ_INVOCATION_TYPE', '$.category');
  if (!(FAILURE_CATEGORIES as readonly string[]).includes(value.category)) {
    invocationError('HQ_INVOCATION_INVALID_VALUE', '$.category');
  }
  const code = boundedText(value.code, '$.code', limits.maxTextBytes);
  if (!FAILURE_CODE_PATTERN.test(code)) invocationError('HQ_INVOCATION_INVALID_VALUE', '$.code');

  const result: Record<string, unknown> = {
    kind: 'hypequery-semantic-invocation-failure',
    version: 1,
    category: value.category,
    code,
    message: boundedText(value.message, '$.message', limits.maxMessageBytes),
    retryable: requireBoolean(value.retryable, '$.retryable'),
    relist: requireBoolean(value.relist, '$.relist'),
  };
  if (value.path !== undefined) {
    result.path = boundedText(value.path, '$.path', limits.maxTextBytes);
  }
  if (value.activationRevision !== undefined) {
    result.activationRevision = activationRevision(
      value.activationRevision,
      '$.activationRevision',
    );
  }
  return freezeRecord(result) as unknown as ProtocolSemanticInvocationFailure;
}
