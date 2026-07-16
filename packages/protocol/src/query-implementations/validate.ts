import { ProtocolExpressionError, validateProtocolSemanticQuery } from '../expressions/index.js';
import {
  ProtocolIdentifierError,
  parseProtocolIdentifier,
  parseProtocolQualifiedIdentifier,
} from '../identifiers/index.js';
import { ProtocolSchemaError, validateProtocolSchema } from '../schemas/index.js';
import { queryImplementationError } from './errors.js';
import { resolveQueryImplementationLimits } from './limits.js';
import type {
  ProtocolQueryImplementation,
  ProtocolQueryImplementationLimits,
  ProtocolQueryImplementationOptions,
  ProtocolSqlExpression,
  ProtocolSqlParameter,
  ProtocolSqlParameterSource,
  ProtocolSqlTenantPolicy,
} from './types.js';

type DataRecord = Record<string, unknown>;
const textEncoder = new TextEncoder();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

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

function exactFields(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', `${path}.${key}`);
  }
}

function freezeRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function identifier(value: unknown, path: string, qualified = false): string {
  try {
    return qualified ? parseProtocolQualifiedIdentifier(value) : parseProtocolIdentifier(value);
  } catch (error) {
    if (error instanceof ProtocolIdentifierError) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER', path);
    }
    throw error;
  }
}

function boundedText(
  value: unknown,
  path: string,
  maxBytes: number,
  allowSqlWhitespace = false,
): string {
  if (typeof value !== 'string') queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', path);
  if (value.trim().length === 0) queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', path);
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code <= 0x1f && !(allowSqlWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)))
      || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', path);
    }
  }
  if (value.length > maxBytes || textEncoder.encode(value).byteLength > maxBytes) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_TOO_LARGE', path);
  }
  return value;
}

function dialect(value: unknown, path: string): 'clickhouse' {
  if (value !== 'clickhouse') queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', path);
  return value;
}

function validateParameterSource(input: unknown, path: string): ProtocolSqlParameterSource {
  const value = requireRecord(input, path);
  if (value.kind === 'input') {
    exactFields(value, ['kind', 'path'], [], path);
    return freezeRecord({
      kind: 'input', path: identifier(value.path, `${path}.path`, true),
    }) as unknown as ProtocolSqlParameterSource;
  }
  if (value.kind === 'tenant') {
    exactFields(value, ['kind'], [], path);
    return freezeRecord({ kind: 'tenant' }) as unknown as ProtocolSqlParameterSource;
  }
  if (typeof value.kind !== 'string') queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', `${path}.kind`);
  queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND', `${path}.kind`);
}

function validateParameters(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolQueryImplementationLimits>,
): readonly ProtocolSqlParameter[] {
  const values = requireArray(input, path, limits.maxCollectionItems);
  const names = new Set<string>();
  const result = values.map((inputValue, index) => {
    const itemPath = `${path}[${index}]`;
    const value = requireRecord(inputValue, itemPath);
    exactFields(value, ['name', 'source', 'clickHouseType'], [], itemPath);
    const name = identifier(value.name, `${itemPath}.name`);
    if (names.has(name)) queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE', `${itemPath}.name`);
    names.add(name);
    return freezeRecord({
      name,
      source: validateParameterSource(value.source, `${itemPath}.source`),
      clickHouseType: boundedText(value.clickHouseType, `${itemPath}.clickHouseType`, limits.maxTypeBytes),
    }) as unknown as ProtocolSqlParameter;
  });
  return Object.freeze(result);
}

function validateTenant(
  input: unknown,
  path: string,
  parameters: readonly ProtocolSqlParameter[],
): ProtocolSqlTenantPolicy {
  const value = requireRecord(input, path);
  if (value.kind === 'not-required') {
    exactFields(value, ['kind'], [], path);
    if (parameters.some(parameter => parameter.source.kind === 'tenant')) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE', path);
    }
    return freezeRecord({ kind: 'not-required' }) as unknown as ProtocolSqlTenantPolicy;
  }
  if (value.kind === 'required') {
    exactFields(value, ['kind', 'parameter'], [], path);
    const parameter = identifier(value.parameter, `${path}.parameter`);
    if (!parameters.some(candidate => candidate.name === parameter && candidate.source.kind === 'tenant')) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE', `${path}.parameter`);
    }
    if (parameters.filter(candidate => candidate.source.kind === 'tenant').length !== 1) {
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE', path);
    }
    return freezeRecord({ kind: 'required', parameter }) as unknown as ProtocolSqlTenantPolicy;
  }
  if (typeof value.kind !== 'string') queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', `${path}.kind`);
  queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND', `${path}.kind`);
}

function validateReadSources(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolQueryImplementationLimits>,
): readonly string[] {
  const values = requireArray(input, path, limits.maxCollectionItems);
  const result = values.map((value, index) =>
    boundedText(value, `${path}[${index}]`, limits.maxSourceBytes));
  if (new Set(result).size !== result.length) {
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', path);
  }
  return Object.freeze(result);
}

export function validateProtocolSqlExpression(
  input: unknown,
  options: ProtocolQueryImplementationOptions = {},
): ProtocolSqlExpression {
  const limits = resolveQueryImplementationLimits(options);
  const value = requireRecord(input, '$');
  exactFields(value, ['kind', 'dialect', 'sql', 'output', 'dependencies'], [], '$');
  if (value.kind !== 'sql-expression') {
    if (typeof value.kind !== 'string') queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', '$.kind');
    queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND', '$.kind');
  }
  const dependencies = requireArray(value.dependencies, '$.dependencies', limits.maxCollectionItems)
    .map((dependency, index) => identifier(dependency, `$.dependencies[${index}]`, true));
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
  return freezeRecord({
    kind: 'sql-expression',
    dialect: dialect(value.dialect, '$.dialect'),
    sql: boundedText(value.sql, '$.sql', limits.maxExpressionBytes, true),
    output,
    dependencies: Object.freeze(dependencies),
  }) as unknown as ProtocolSqlExpression;
}

export function validateProtocolQueryImplementation(
  input: unknown,
  options: ProtocolQueryImplementationOptions = {},
): ProtocolQueryImplementation {
  const limits = resolveQueryImplementationLimits(options);
  const value = requireRecord(input, '$');
  if (typeof value.kind !== 'string') queryImplementationError('HQ_QUERY_IMPLEMENTATION_TYPE', '$.kind');
  switch (value.kind) {
    case 'semantic-plan': {
      exactFields(value, ['kind', 'query'], [], '$');
      try {
        return freezeRecord({
          kind: 'semantic-plan', query: validateProtocolSemanticQuery(value.query),
        }) as unknown as ProtocolQueryImplementation;
      } catch (error) {
        if (error instanceof ProtocolExpressionError) {
          queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', '$.query');
        }
        throw error;
      }
    }
    case 'compiled-sql': {
      exactFields(value, [
        'kind', 'dialect', 'operation', 'statement', 'parameters', 'readSources', 'tenant',
      ], [], '$');
      if (value.operation !== 'select') {
        queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', '$.operation');
      }
      const parameters = validateParameters(value.parameters, '$.parameters', limits);
      return freezeRecord({
        kind: 'compiled-sql',
        dialect: dialect(value.dialect, '$.dialect'),
        operation: 'select',
        statement: boundedText(value.statement, '$.statement', limits.maxStatementBytes, true),
        parameters,
        readSources: validateReadSources(value.readSources, '$.readSources', limits),
        tenant: validateTenant(value.tenant, '$.tenant', parameters),
      }) as unknown as ProtocolQueryImplementation;
    }
    case 'runtime-reference': {
      exactFields(value, ['kind', 'runtime', 'artifactSha256', 'entrypoint'], [], '$');
      if (value.runtime !== 'node' && value.runtime !== 'python') {
        queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', '$.runtime');
      }
      if (typeof value.artifactSha256 !== 'string' || !SHA256_PATTERN.test(value.artifactSha256)) {
        queryImplementationError('HQ_QUERY_IMPLEMENTATION_INVALID_VALUE', '$.artifactSha256');
      }
      return freezeRecord({
        kind: 'runtime-reference',
        runtime: value.runtime,
        artifactSha256: value.artifactSha256,
        entrypoint: identifier(value.entrypoint, '$.entrypoint', true),
      }) as unknown as ProtocolQueryImplementation;
    }
    default:
      queryImplementationError('HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND', '$.kind');
  }
}
