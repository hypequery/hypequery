import { ProtocolIdentifierError, parseProtocolIdentifier, parseProtocolQualifiedIdentifier } from '../identifiers/index.js';
import { deploymentError } from './errors.js';
import {
  PROTOCOL_SQL_SOURCE_MAX_DEPENDENCIES,
  analyzeProtocolSqlSource,
} from './sql-source-analysis.js';
import type { ProtocolDatasetFieldType, ProtocolDeploymentLimits, ProtocolSqlSource, ProtocolSqlSourceColumn } from './types.js';

const FIELD_TYPES = new Set<string>(['string', 'number', 'boolean', 'timestamp']);

function record(input: unknown, path: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) deploymentError('HQ_DEPLOYMENT_TYPE', path);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) {
      deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
    }
  }
  return input as Record<string, unknown>;
}

function list(input: unknown, path: string, maxItems: number): readonly unknown[] {
  if (!Array.isArray(input)) deploymentError('HQ_DEPLOYMENT_TYPE', path);
  if (Object.getPrototypeOf(input) !== Array.prototype || Object.getOwnPropertySymbols(input).length > 0
    || Object.keys(input).length !== input.length) {
    deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  }
  if (input.length === 0) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
  if (input.length > maxItems) deploymentError('HQ_DEPLOYMENT_TOO_MANY_ITEMS', path);
  return input;
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) deploymentError('HQ_DEPLOYMENT_UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.${key}`);
}

function parseIdentifier<T>(value: unknown, path: string, parse: (value: unknown) => T): T {
  try {
    return parse(value);
  } catch (error) {
    if (error instanceof ProtocolIdentifierError) deploymentError('HQ_DEPLOYMENT_INVALID_IDENTIFIER', path);
    throw error;
  }
}

/**
 * Validate an RFC 0028 SQL source: its shape, then the SQL rules and the
 * dependency coverage `analyzeProtocolSqlSource` checks.
 */
export function validateProtocolSqlSource(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolSqlSource {
  const value = record(input, path);
  exact(value, ['kind', 'dialect', 'sql', 'dependencies', 'columns'], path);
  if (value.kind !== 'sql') deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
  if (value.dialect !== 'clickhouse') deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.dialect`);
  if (typeof value.sql !== 'string') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.sql`);
  const dependencies = list(value.dependencies, `${path}.dependencies`, PROTOCOL_SQL_SOURCE_MAX_DEPENDENCIES)
    .map((dependency, index) => parseIdentifier(dependency, `${path}.dependencies[${index}]`, parseProtocolQualifiedIdentifier));
  if (new Set(dependencies).size !== dependencies.length) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.dependencies`);
  const columns = list(value.columns, `${path}.columns`, limits.maxDatasetItems).map((item, index): ProtocolSqlSourceColumn => {
    const columnPath = `${path}.columns[${index}]`;
    const column = record(item, columnPath);
    exact(column, ['name', 'type'], columnPath);
    const name = parseIdentifier(column.name, `${columnPath}.name`, parseProtocolIdentifier);
    if (typeof column.type !== 'string' || !FIELD_TYPES.has(column.type)) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${columnPath}.type`);
    return Object.freeze({ name, type: column.type as ProtocolDatasetFieldType });
  });
  if (new Set(columns.map(column => column.name)).size !== columns.length) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.columns`);
  }
  const analysis = analyzeProtocolSqlSource(value.sql, dependencies);
  if (!analysis.ok) {
    if (analysis.reason === 'too-large') deploymentError('HQ_DEPLOYMENT_TOO_LARGE', `${path}.sql`);
    if (analysis.reason === 'undeclared-dependency' || analysis.reason === 'unused-dependency') {
      deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', `${path}.dependencies`);
    }
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.sql`);
  }
  return Object.freeze({
    kind: 'sql',
    dialect: 'clickhouse',
    sql: value.sql,
    dependencies: Object.freeze(dependencies),
    columns: Object.freeze(columns),
  });
}

export function isProtocolSqlSource(source: unknown): source is ProtocolSqlSource {
  return typeof source === 'object' && source !== null && (source as { kind?: unknown }).kind === 'sql';
}
