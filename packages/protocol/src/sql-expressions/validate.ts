/** SQL-backed dataset fields and named-query implementations share this validator. */
import { ProtocolIdentifierError, parseProtocolQualifiedIdentifier } from '../identifiers/index.js';
import { ProtocolSchemaError, validateProtocolSchema } from '../schemas/index.js';
import { queryImplementationError } from '../query-implementations/errors.js';
import { resolveQueryImplementationLimits } from '../query-implementations/limits.js';
import type {
  ProtocolQueryImplementationOptions,
  ProtocolSqlExpression,
} from '../query-implementations/types.js';

type DataRecord = Record<string, unknown>;
const textEncoder = new TextEncoder();

function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT', path);
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT', path);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT', path);
    }
  }
  return input as DataRecord;
}

function requireArray(input: unknown, path: string, maxItems: number): readonly unknown[] {
  if (!Array.isArray(input)) queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', path);
  if (Object.getPrototypeOf(input) !== Array.prototype || Object.getOwnPropertySymbols(input).length > 0) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT', path);
  }
  if (input.length > maxItems) queryImplementationError('HQ_QUERY_IMPLEMENTATION_TOO_MANY_ITEMS', path);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT', `${path}[${index}]`);
    }
  }
  if (Object.keys(input).length !== input.length) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT', path);
  }
  return input;
}

function exactFields(value: DataRecord, required: readonly string[], path: string): void {
  const allowed = new Set(required);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', `${path}.${key}`);
  }
}

function qualifiedIdentifier(value: unknown, path: string): string {
  try {
    return parseProtocolQualifiedIdentifier(value);
  } catch (error) {
    if (error instanceof ProtocolIdentifierError) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER', path);
    }
    throw error;
  }
}

function sqlText(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== 'string') queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', path);
  if (value.trim().length === 0) queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', path);
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d)
      || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', path);
    }
  }
  if (value.length > maxBytes || textEncoder.encode(value).byteLength > maxBytes) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_TOO_LARGE', path);
  }
  return value;
}

/** Kept under query-implementation's stable error and limit policy for v1 callers. */
export function validateProtocolSqlExpression(
  input: unknown,
  options: ProtocolQueryImplementationOptions = {},
): ProtocolSqlExpression {
  const limits = resolveQueryImplementationLimits(options);
  const value = requireRecord(input, '$');
  exactFields(value, ['kind', 'dialect', 'sql', 'output', 'dependencies'], '$');
  if (value.kind !== 'sql-expression') {
    if (typeof value.kind !== 'string') queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', '$.kind');
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND', '$.kind');
  }
  const dependencies = requireArray(value.dependencies, '$.dependencies', limits.maxCollectionItems)
    .map((dependency, index) => qualifiedIdentifier(dependency, `$.dependencies[${index}]`));
  if (new Set(dependencies).size !== dependencies.length) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', '$.dependencies');
  }
  let output;
  try {
    output = validateProtocolSchema(value.output);
  } catch (error) {
    if (error instanceof ProtocolSchemaError) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', '$.output');
    }
    throw error;
  }
  if (value.dialect !== 'clickhouse') {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', '$.dialect');
  }
  return Object.freeze(Object.assign(Object.create(null), {
    kind: 'sql-expression',
    dialect: 'clickhouse',
    sql: sqlText(value.sql, '$.sql', limits.maxExpressionBytes),
    output,
    dependencies: Object.freeze(dependencies),
  })) as ProtocolSqlExpression;
}
