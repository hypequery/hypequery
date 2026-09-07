import { ProtocolExpressionError, validateProtocolExpression } from '../expressions/index.js';
import {
  ProtocolIdentifierError,
  parseProtocolIdentifier,
  parseProtocolQualifiedIdentifier,
} from '../identifiers/index.js';
import {
  ProtocolQueryImplementationError,
  validateProtocolQueryImplementation,
  validateProtocolSqlExpression,
} from '../query-implementations/index.js';
import {
  ProtocolSchemaError,
  validateProtocolSchema,
  type ProtocolSchema,
} from '../schemas/index.js';
import { deploymentError } from './errors.js';
import { resolveDeploymentLimits } from './limits.js';
import type {
  ProtocolAccessPolicy,
  ProtocolDatasetContract,
  ProtocolDatasetDimension,
  ProtocolDatasetFieldSource,
  ProtocolDatasetFilter,
  ProtocolDatasetLimits,
  ProtocolDatasetMeasure,
  ProtocolDatasetMetric,
  ProtocolDatasetRelationship,
  ProtocolDatasetTenantPolicy,
  ProtocolDeploymentContract,
  ProtocolDeploymentLimits,
  ProtocolDeploymentOptions,
  ProtocolEndpointPolicy,
  ProtocolEndpointTenantPolicy,
  ProtocolNamedQueryContract,
  ProtocolRuntimeArtifact,
} from './types.js';

type DataRecord = Record<string, unknown>;
const textEncoder = new TextEncoder();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AGGREGATIONS = new Set([
  'sum', 'count', 'countDistinct', 'avg', 'min', 'max',
  'argMax', 'argMin', 'percentile', 'stddev', 'variance',
]);
const OPERATORS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like',
]);
const GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const SENSITIVITIES = new Set(['public', 'internal', 'confidential', 'restricted']);
const SEMANTIC_METADATA_FIELDS = [
  'examples', 'synonyms', 'format', 'unit', 'currency', 'timezone', 'sensitivity',
] as const;

function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    deploymentError('HQ_DEPLOYMENT_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
    }
  }
  return input as DataRecord;
}

function requireArray(input: unknown, path: string, maxItems: number): readonly unknown[] {
  if (!Array.isArray(input)) deploymentError('HQ_DEPLOYMENT_TYPE', path);
  if (Object.getPrototypeOf(input) !== Array.prototype || Object.getOwnPropertySymbols(input).length > 0) {
    deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  }
  if (input.length > maxItems) deploymentError('HQ_DEPLOYMENT_TOO_MANY_ITEMS', path);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', `${path}[${index}]`);
    }
  }
  if (Object.keys(input).length !== input.length) deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
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
    if (!allowed.has(key)) deploymentError('HQ_DEPLOYMENT_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.${key}`);
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
      deploymentError('HQ_DEPLOYMENT_INVALID_IDENTIFIER', path);
    }
    throw error;
  }
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== 'string') deploymentError('HQ_DEPLOYMENT_TYPE', path);
  if (value.trim().length === 0) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
    }
  }
  if (value.length > maxBytes || textEncoder.encode(value).byteLength > maxBytes) {
    deploymentError('HQ_DEPLOYMENT_TOO_LARGE', path);
  }
  return value;
}

function optionalText(
  value: unknown,
  key: string,
  result: Record<string, unknown>,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): void {
  if (value !== undefined) result[key] = boundedText(value, `${path}.${key}`, limits.maxTextBytes);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
  }
  return value as number;
}

function uniqueStrings(
  input: unknown,
  path: string,
  maxItems: number,
  parse: (value: unknown, path: string) => string,
): readonly string[] {
  const result = requireArray(input, path, maxItems).map((value, index) => parse(value, `${path}[${index}]`));
  if (new Set(result).size !== result.length) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
  return Object.freeze(result);
}

function validateSemanticMetadata(
  value: DataRecord,
  result: Record<string, unknown>,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): void {
  const parseText = (item: unknown, itemPath: string) => (
    boundedText(item, itemPath, limits.maxTextBytes)
  );
  for (const key of ['examples', 'synonyms'] as const) {
    if (value[key] !== undefined) {
      result[key] = uniqueStrings(
        value[key], `${path}.${key}`, limits.maxSemanticMetadataItems, parseText,
      );
    }
  }
  for (const key of ['format', 'unit', 'timezone'] as const) {
    optionalText(value[key], key, result, path, limits);
  }
  if (value.currency !== undefined) {
    const currency = boundedText(value.currency, `${path}.currency`, limits.maxTextBytes);
    if (!/^[A-Z]{3}$/.test(currency)) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.currency`);
    }
    result.currency = currency;
  }
  if (value.sensitivity !== undefined) {
    if (typeof value.sensitivity !== 'string' || !SENSITIVITIES.has(value.sensitivity)) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.sensitivity`);
    }
    result.sensitivity = value.sensitivity;
  }
}

function validateAccess(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolAccessPolicy {
  const value = requireRecord(input, path);
  if (value.kind === 'public') {
    exactFields(value, ['kind'], [], path);
    return freezeRecord({ kind: 'public' }) as unknown as ProtocolAccessPolicy;
  }
  if (value.kind === 'authenticated') {
    exactFields(value, ['kind', 'roles', 'scopes'], [], path);
    const parseClaim = (claim: unknown, claimPath: string) =>
      boundedText(claim, claimPath, limits.maxTextBytes);
    return freezeRecord({
      kind: 'authenticated',
      roles: uniqueStrings(value.roles, `${path}.roles`, limits.maxDatasetItems, parseClaim),
      scopes: uniqueStrings(value.scopes, `${path}.scopes`, limits.maxDatasetItems, parseClaim),
    }) as unknown as ProtocolAccessPolicy;
  }
  if (typeof value.kind !== 'string') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.kind`);
  deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
}

function validateEndpointTenant(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolEndpointTenantPolicy {
  const value = requireRecord(input, path);
  if (value.kind === 'not-required') {
    exactFields(value, ['kind'], [], path);
    return freezeRecord({ kind: 'not-required' }) as unknown as ProtocolEndpointTenantPolicy;
  }
  if (value.kind === 'required' || value.kind === 'optional') {
    exactFields(value, ['kind', 'mode'], ['column'], path);
    if (value.mode !== 'auto-inject' && value.mode !== 'manual') {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.mode`);
    }
    const result: Record<string, unknown> = { kind: value.kind, mode: value.mode };
    if (value.column !== undefined) {
      result.column = boundedText(value.column, `${path}.column`, limits.maxSourceBytes);
    }
    if (value.mode === 'auto-inject' && value.column === undefined) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.column`);
    }
    return freezeRecord(result) as unknown as ProtocolEndpointTenantPolicy;
  }
  if (typeof value.kind !== 'string') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.kind`);
  deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
}

function validateEndpoint(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
  transport = false,
): ProtocolEndpointPolicy & { method?: string; path?: string } {
  const value = requireRecord(input, path);
  exactFields(
    value,
    transport ? ['access', 'tenant', 'method', 'path'] : ['access', 'tenant'],
    transport ? ['cacheTtlMs', 'maxLimit'] : ['cacheTtlMs', 'maxLimit', 'path'],
    path,
  );
  const result: Record<string, unknown> = {
    access: validateAccess(value.access, `${path}.access`, limits),
    tenant: validateEndpointTenant(value.tenant, `${path}.tenant`, limits),
  };
  if (value.cacheTtlMs !== undefined) result.cacheTtlMs = positiveInteger(value.cacheTtlMs, `${path}.cacheTtlMs`);
  if (value.maxLimit !== undefined) result.maxLimit = positiveInteger(value.maxLimit, `${path}.maxLimit`);
  if (!transport && value.path !== undefined) {
    const endpointPath = boundedText(value.path, `${path}.path`, limits.maxPathBytes);
    if (!endpointPath.startsWith('/')) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.path`);
    result.path = endpointPath;
  }
  if (transport) {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(value.method as string)) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.method`);
    }
    const endpointPath = boundedText(value.path, `${path}.path`, limits.maxPathBytes);
    if (!endpointPath.startsWith('/')) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.path`);
    result.method = value.method;
    result.path = endpointPath;
  }
  return freezeRecord(result) as unknown as ProtocolEndpointPolicy & { method?: string; path?: string };
}

function validateTenant(input: unknown, path: string, limits: Readonly<ProtocolDeploymentLimits>): ProtocolDatasetTenantPolicy {
  const value = requireRecord(input, path);
  if (value.kind === 'not-required') {
    exactFields(value, ['kind'], [], path);
    return freezeRecord({ kind: 'not-required' }) as unknown as ProtocolDatasetTenantPolicy;
  }
  if (value.kind === 'required') {
    exactFields(value, ['kind', 'field'], [], path);
    return freezeRecord({
      kind: 'required',
      field: boundedText(value.field, `${path}.field`, limits.maxSourceBytes),
    }) as unknown as ProtocolDatasetTenantPolicy;
  }
  if (typeof value.kind !== 'string') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.kind`);
  deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
}

function nested<T>(action: () => T, path: string): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof ProtocolExpressionError
      || error instanceof ProtocolQueryImplementationError
      || error instanceof ProtocolSchemaError) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
    }
    throw error;
  }
}

function validateFieldSource(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolDatasetFieldSource {
  const value = requireRecord(input, path);
  if (value.kind === 'column') {
    exactFields(value, ['kind', 'column'], [], path);
    return freezeRecord({
      kind: 'column',
      column: boundedText(value.column, `${path}.column`, limits.maxSourceBytes),
    }) as unknown as ProtocolDatasetFieldSource;
  }
  return nested(() => validateProtocolSqlExpression(value), path);
}

function validateDimension(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolDatasetDimension {
  const value = requireRecord(input, path);
  exactFields(
    value,
    ['name', 'type', 'source', 'filterable', 'groupable'],
    ['label', 'description', ...SEMANTIC_METADATA_FIELDS],
    path,
  );
  if (!['string', 'number', 'boolean', 'timestamp'].includes(value.type as string)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.type`);
  }
  if (typeof value.filterable !== 'boolean') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.filterable`);
  if (typeof value.groupable !== 'boolean') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.groupable`);
  const result: Record<string, unknown> = {
    name: identifier(value.name, `${path}.name`),
    type: value.type,
    source: validateFieldSource(value.source, `${path}.source`, limits),
    filterable: value.filterable,
    groupable: value.groupable,
  };
  optionalText(value.label, 'label', result, path, limits);
  optionalText(value.description, 'description', result, path, limits);
  validateSemanticMetadata(value, result, path, limits);
  return freezeRecord(result) as unknown as ProtocolDatasetDimension;
}

function validateMeasure(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolDatasetMeasure {
  const value = requireRecord(input, path);
  exactFields(
    value,
    ['name', 'aggregation', 'field', 'filters'],
    ['argField', 'level', 'sql', 'label', 'description', ...SEMANTIC_METADATA_FIELDS],
    path,
  );
  if (typeof value.aggregation !== 'string' || !AGGREGATIONS.has(value.aggregation)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.aggregation`);
  }
  const needsArg = value.aggregation === 'argMax' || value.aggregation === 'argMin';
  if (needsArg !== (value.argField !== undefined)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.argField`);
  }
  if (value.aggregation === 'percentile') {
    if (typeof value.level !== 'number' || !Number.isFinite(value.level) || value.level < 0 || value.level > 1) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.level`);
    }
  } else if (value.level !== undefined) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.level`);
  }
  const result: Record<string, unknown> = {
    name: identifier(value.name, `${path}.name`),
    aggregation: value.aggregation,
    field: identifier(value.field, `${path}.field`, true),
    filters: Object.freeze(requireArray(value.filters, `${path}.filters`, limits.maxDatasetItems)
      .map((filter, index) => nested(
        () => validateProtocolExpression(filter),
        `${path}.filters[${index}]`,
      ))),
  };
  if (value.argField !== undefined) result.argField = identifier(value.argField, `${path}.argField`, true);
  if (value.level !== undefined) result.level = value.level;
  if (value.sql !== undefined) result.sql = nested(() => validateProtocolSqlExpression(value.sql), `${path}.sql`);
  optionalText(value.label, 'label', result, path, limits);
  optionalText(value.description, 'description', result, path, limits);
  validateSemanticMetadata(value, result, path, limits);
  return freezeRecord(result) as unknown as ProtocolDatasetMeasure;
}

function validateFilter(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolDatasetFilter {
  const value = requireRecord(input, path);
  exactFields(
    value,
    ['name', 'field', 'operators'],
    ['label', 'description', ...SEMANTIC_METADATA_FIELDS],
    path,
  );
  const operators = uniqueStrings(
    value.operators,
    `${path}.operators`,
    limits.maxDatasetItems,
    (operator, operatorPath) => {
      if (typeof operator !== 'string' || !OPERATORS.has(operator)) {
        deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', operatorPath);
      }
      return operator;
    },
  );
  if (operators.length === 0) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.operators`);
  const result: Record<string, unknown> = {
    name: identifier(value.name, `${path}.name`),
    field: identifier(value.field, `${path}.field`, true),
    operators,
  };
  optionalText(value.label, 'label', result, path, limits);
  optionalText(value.description, 'description', result, path, limits);
  validateSemanticMetadata(value, result, path, limits);
  return freezeRecord(result) as unknown as ProtocolDatasetFilter;
}

function validateRelationship(
  input: unknown,
  path: string,
): ProtocolDatasetRelationship {
  const value = requireRecord(input, path);
  exactFields(value, ['name', 'kind', 'target', 'from', 'to', 'queryable'], [], path);
  if (!['belongsTo', 'hasMany', 'hasOne'].includes(value.kind as string)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
  }
  if (typeof value.queryable !== 'boolean') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.queryable`);
  if ((value.kind === 'hasMany') === value.queryable) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.queryable`);
  }
  return freezeRecord({
    name: identifier(value.name, `${path}.name`),
    kind: value.kind,
    target: identifier(value.target, `${path}.target`),
    from: identifier(value.from, `${path}.from`, true),
    to: identifier(value.to, `${path}.to`, true),
    queryable: value.queryable,
  }) as unknown as ProtocolDatasetRelationship;
}

function validateMetric(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolDatasetMetric {
  const value = requireRecord(input, path);
  exactFields(
    value,
    ['name', 'kind', 'expression', 'dimensions', 'filters', 'grains', 'endpoint'],
    ['grain', 'label', 'description', ...SEMANTIC_METADATA_FIELDS],
    path,
  );
  if (!['metric', 'derived-metric', 'grained-metric'].includes(value.kind as string)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
  }
  const parseGrain = (grain: unknown, grainPath: string) => {
    if (typeof grain !== 'string' || !GRAINS.has(grain)) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', grainPath);
    }
    return grain;
  };
  const grains = uniqueStrings(value.grains, `${path}.grains`, limits.maxDatasetItems, parseGrain);
  if ((value.kind === 'grained-metric') !== (value.grain !== undefined)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.grain`);
  }
  const grain = value.grain === undefined
    ? undefined
    : parseGrain(value.grain, `${path}.grain`);
  if (grain !== undefined && grains.length === 0) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.grains`);
  }
  if (grain !== undefined && !grains.includes(grain)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.grain`);
  }
  const result: Record<string, unknown> = {
    name: identifier(value.name, `${path}.name`),
    kind: value.kind,
    expression: nested(() => validateProtocolExpression(value.expression), `${path}.expression`),
    dimensions: uniqueStrings(
      value.dimensions,
      `${path}.dimensions`,
      limits.maxDatasetItems,
      (item, itemPath) => identifier(item, itemPath, true),
    ),
    filters: uniqueStrings(
      value.filters,
      `${path}.filters`,
      limits.maxDatasetItems,
      (item, itemPath) => identifier(item, itemPath),
    ),
    grains,
    endpoint: validateEndpoint(value.endpoint, `${path}.endpoint`, limits),
  };
  if (grain !== undefined) result.grain = grain;
  optionalText(value.label, 'label', result, path, limits);
  optionalText(value.description, 'description', result, path, limits);
  validateSemanticMetadata(value, result, path, limits);
  return freezeRecord(result) as unknown as ProtocolDatasetMetric;
}

function validateLimits(input: unknown, path: string): ProtocolDatasetLimits {
  const value = requireRecord(input, path);
  exactFields(value, [], ['maxDimensions', 'maxMeasures', 'maxFilters', 'maxResultSize'], path);
  const result: Record<string, unknown> = {};
  for (const key of ['maxDimensions', 'maxMeasures', 'maxFilters', 'maxResultSize'] as const) {
    if (value[key] !== undefined) result[key] = positiveInteger(value[key], `${path}.${key}`);
  }
  return freezeRecord(result) as unknown as ProtocolDatasetLimits;
}

function validateFreshness(input: unknown, path: string): Record<string, unknown> {
  const value = requireRecord(input, path);
  exactFields(value, ['maxAgeSeconds'], [], path);
  return freezeRecord({
    maxAgeSeconds: positiveInteger(value.maxAgeSeconds, `${path}.maxAgeSeconds`),
  });
}

function validateDefaults(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): Record<string, unknown> {
  const value = requireRecord(input, path);
  exactFields(value, [], ['dimensions', 'timeGrain'], path);
  const result: Record<string, unknown> = {};
  if (value.dimensions !== undefined) {
    result.dimensions = uniqueStrings(
      value.dimensions,
      `${path}.dimensions`,
      limits.maxSemanticMetadataItems,
      (dimension, dimensionPath) => identifier(dimension, dimensionPath),
    );
  }
  if (value.timeGrain !== undefined) {
    if (typeof value.timeGrain !== 'string' || !GRAINS.has(value.timeGrain)) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.timeGrain`);
    }
    result.timeGrain = value.timeGrain;
  }
  if (Object.keys(result).length === 0) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
  }
  return freezeRecord(result);
}

function namedItems<T extends { readonly name: string }>(
  input: unknown,
  path: string,
  maxItems: number,
  validate: (value: unknown, path: string) => T,
): readonly T[] {
  const items = requireArray(input, path, maxItems).map((value, index) => validate(value, `${path}[${index}]`));
  if (new Set(items.map(item => item.name)).size !== items.length) {
    deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', path);
  }
  return Object.freeze(items);
}

function validateDataset(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolDatasetContract {
  const value = requireRecord(input, path);
  exactFields(
    value,
    ['name', 'source', 'tenant', 'dimensions', 'measures', 'filters', 'metrics', 'relationships'],
    [
      'description', 'freshness', 'owner', 'defaults',
      ...SEMANTIC_METADATA_FIELDS,
      'timeField', 'limits', 'endpoint',
    ],
    path,
  );
  const result: Record<string, unknown> = {
    name: identifier(value.name, `${path}.name`),
    source: boundedText(value.source, `${path}.source`, limits.maxSourceBytes),
    tenant: validateTenant(value.tenant, `${path}.tenant`, limits),
    dimensions: namedItems(
      value.dimensions, `${path}.dimensions`, limits.maxDatasetItems,
      (item, itemPath) => validateDimension(item, itemPath, limits),
    ),
    measures: namedItems(
      value.measures, `${path}.measures`, limits.maxDatasetItems,
      (item, itemPath) => validateMeasure(item, itemPath, limits),
    ),
    filters: namedItems(
      value.filters, `${path}.filters`, limits.maxDatasetItems,
      (item, itemPath) => validateFilter(item, itemPath, limits),
    ),
    metrics: namedItems(
      value.metrics, `${path}.metrics`, limits.maxDatasetItems,
      (item, itemPath) => validateMetric(item, itemPath, limits),
    ),
    relationships: namedItems(
      value.relationships, `${path}.relationships`, limits.maxDatasetItems,
      (item, itemPath) => validateRelationship(item, itemPath),
    ),
  };
  if (value.timeField !== undefined) result.timeField = identifier(value.timeField, `${path}.timeField`, true);
  optionalText(value.description, 'description', result, path, limits);
  optionalText(value.owner, 'owner', result, path, limits);
  validateSemanticMetadata(value, result, path, limits);
  if (value.freshness !== undefined) {
    result.freshness = validateFreshness(value.freshness, `${path}.freshness`);
  }
  if (value.defaults !== undefined) {
    result.defaults = validateDefaults(value.defaults, `${path}.defaults`, limits);
  }
  if (value.limits !== undefined) result.limits = validateLimits(value.limits, `${path}.limits`);
  if (value.endpoint !== undefined) result.endpoint = validateEndpoint(value.endpoint, `${path}.endpoint`, limits);
  return freezeRecord(result) as unknown as ProtocolDatasetContract;
}

export function validateProtocolDatasetContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): ProtocolDatasetContract {
  return validateDataset(input, '$', resolveDeploymentLimits(options));
}

function validateQuery(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolNamedQueryContract {
  const value = requireRecord(input, path);
  exactFields(
    value,
    ['name', 'input', 'output', 'implementation', 'endpoint', 'tags'],
    ['summary', 'description'],
    path,
  );
  const result: Record<string, unknown> = {
    name: identifier(value.name, `${path}.name`),
    input: nested(() => validateProtocolSchema(value.input), `${path}.input`),
    output: nested(() => validateProtocolSchema(value.output), `${path}.output`),
    implementation: nested(
      () => validateProtocolQueryImplementation(value.implementation),
      `${path}.implementation`,
    ),
    endpoint: validateEndpoint(value.endpoint, `${path}.endpoint`, limits, true),
    tags: uniqueStrings(
      value.tags,
      `${path}.tags`,
      limits.maxDatasetItems,
      (tag, tagPath) => boundedText(tag, tagPath, limits.maxTextBytes),
    ),
  };
  optionalText(value.summary, 'summary', result, path, limits);
  optionalText(value.description, 'description', result, path, limits);
  return freezeRecord(result) as unknown as ProtocolNamedQueryContract;
}

function validateArtifact(input: unknown, path: string): ProtocolRuntimeArtifact {
  const value = requireRecord(input, path);
  exactFields(value, ['runtime', 'artifactSha256'], [], path);
  if (value.runtime !== 'node' && value.runtime !== 'python') {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.runtime`);
  }
  if (typeof value.artifactSha256 !== 'string' || !SHA256_PATTERN.test(value.artifactSha256)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.artifactSha256`);
  }
  return freezeRecord({
    runtime: value.runtime,
    artifactSha256: value.artifactSha256,
  }) as unknown as ProtocolRuntimeArtifact;
}

function validateReferences(contract: ProtocolDeploymentContract): void {
  const datasets = new Map(contract.datasets.map(dataset => [dataset.name, dataset]));
  for (const [datasetIndex, dataset] of contract.datasets.entries()) {
    if (dataset.defaults?.dimensions?.some(name => (
      !dataset.dimensions.some(dimension => dimension.name === name && dimension.groupable)
    ))) {
      deploymentError(
        'HQ_DEPLOYMENT_INVALID_REFERENCE',
        `$.datasets[${datasetIndex}].defaults.dimensions`,
      );
    }
    if (dataset.defaults?.timeGrain !== undefined && dataset.timeField === undefined) {
      deploymentError(
        'HQ_DEPLOYMENT_INVALID_REFERENCE',
        `$.datasets[${datasetIndex}].defaults.timeGrain`,
      );
    }
    for (const [relationshipIndex, relationship] of dataset.relationships.entries()) {
      if (!datasets.has(relationship.target)) {
        deploymentError(
          'HQ_DEPLOYMENT_INVALID_REFERENCE',
          `$.datasets[${datasetIndex}].relationships[${relationshipIndex}].target`,
        );
      }
    }
    const filters = new Set(dataset.filters.map(filter => filter.name));
    const hasDimension = (name: string): boolean => {
      const [head, ...tail] = name.split('.');
      if (tail.length === 0) return dataset.dimensions.some(dimension => dimension.name === head);
      const relationship = dataset.relationships.find(candidate => candidate.name === head && candidate.queryable);
      const target = relationship ? datasets.get(relationship.target) : undefined;
      return target?.dimensions.some(dimension => dimension.name === tail.join('.')) ?? false;
    };
    for (const [metricIndex, metric] of dataset.metrics.entries()) {
      if (metric.dimensions.some(dimension => !hasDimension(dimension))
        || metric.filters.some(filter => !filters.has(filter))) {
        deploymentError(
          'HQ_DEPLOYMENT_INVALID_REFERENCE',
          `$.datasets[${datasetIndex}].metrics[${metricIndex}]`,
        );
      }
      if ((metric.kind === 'grained-metric' || metric.grains.length > 0)
        && dataset.timeField === undefined) {
        deploymentError(
          'HQ_DEPLOYMENT_INVALID_REFERENCE',
          `$.datasets[${datasetIndex}].metrics[${metricIndex}].grains`,
        );
      }
      if (dataset.tenant.kind === 'required' && metric.endpoint.tenant.kind !== 'required') {
        deploymentError(
          'HQ_DEPLOYMENT_INVALID_REFERENCE',
          `$.datasets[${datasetIndex}].metrics[${metricIndex}].endpoint.tenant`,
        );
      }
    }
    if (dataset.tenant.kind === 'required'
      && dataset.endpoint !== undefined
      && dataset.endpoint.tenant.kind !== 'required') {
      deploymentError(
        'HQ_DEPLOYMENT_INVALID_REFERENCE',
        `$.datasets[${datasetIndex}].endpoint.tenant`,
      );
    }
  }
  const artifacts = new Map(contract.artifacts.map(artifact => [artifact.artifactSha256, artifact.runtime]));
  for (const [queryIndex, query] of contract.queries.entries()) {
    if (query.implementation.kind === 'runtime-reference'
      && artifacts.get(query.implementation.artifactSha256) !== query.implementation.runtime) {
      deploymentError(
        'HQ_DEPLOYMENT_INVALID_REFERENCE',
        `$.queries[${queryIndex}].implementation.artifactSha256`,
      );
    }
    if (query.implementation.kind === 'compiled-sql') {
      const implementationRequiresTenant = query.implementation.tenant.kind === 'required';
      const endpointRequiresTenant = query.endpoint.tenant.kind === 'required';
      if (implementationRequiresTenant !== endpointRequiresTenant) {
        deploymentError(
          'HQ_DEPLOYMENT_INVALID_REFERENCE',
          `$.queries[${queryIndex}].endpoint.tenant`,
        );
      }
      for (const [parameterIndex, parameter] of query.implementation.parameters.entries()) {
        if (parameter.source.kind === 'input'
          && !schemaContainsPath(query.input, parameter.source.path.split('.'))) {
          deploymentError(
            'HQ_DEPLOYMENT_INVALID_REFERENCE',
            `$.queries[${queryIndex}].implementation.parameters[${parameterIndex}].source.path`,
          );
        }
      }
    }
    if (query.implementation.kind === 'semantic-plan') {
      const dataset = datasets.get(query.implementation.query.dataset);
      if (!dataset) {
        deploymentError(
          'HQ_DEPLOYMENT_INVALID_REFERENCE',
          `$.queries[${queryIndex}].implementation.query.dataset`,
        );
      }
      if (dataset.tenant.kind === 'required' && query.endpoint.tenant.kind !== 'required') {
        deploymentError(
          'HQ_DEPLOYMENT_INVALID_REFERENCE',
          `$.queries[${queryIndex}].endpoint.tenant`,
        );
      }
    }
  }
}

function schemaContainsPath(
  schema: ProtocolSchema,
  segments: readonly string[],
): boolean {
  if (segments.length === 0) return true;
  if (schema.kind === 'any') return true;
  if (schema.kind === 'union') {
    return schema.variants.every(variant => schemaContainsPath(variant, segments));
  }
  if (schema.kind === 'record') {
    return schemaContainsPath(schema.values, segments.slice(1));
  }
  if (schema.kind !== 'object') return false;
  const [head, ...tail] = segments;
  const property = schema.properties[head as keyof typeof schema.properties];
  return property !== undefined && schemaContainsPath(property, tail);
}

export function validateProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): ProtocolDeploymentContract {
  const limits = resolveDeploymentLimits(options);
  const value = requireRecord(input, '$');
  exactFields(value, ['kind', 'version', 'datasets', 'queries', 'artifacts'], [], '$');
  if (value.kind !== 'hypequery-deployment') deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', '$.kind');
  if (value.version !== 1) deploymentError('HQ_DEPLOYMENT_INVALID_VERSION', '$.version');
  const datasets = namedItems(
    value.datasets,
    '$.datasets',
    limits.maxDatasets,
    (dataset, path) => validateDataset(dataset, path, limits),
  );
  const queries = namedItems(
    value.queries,
    '$.queries',
    limits.maxQueries,
    (query, path) => validateQuery(query, path, limits),
  );
  const artifacts = Object.freeze(requireArray(value.artifacts, '$.artifacts', limits.maxArtifacts)
    .map((artifact, index) => validateArtifact(artifact, `$.artifacts[${index}]`)));
  if (new Set(artifacts.map(artifact => artifact.artifactSha256)).size !== artifacts.length) {
    deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', '$.artifacts');
  }
  const result = freezeRecord({
    kind: 'hypequery-deployment',
    version: 1,
    datasets,
    queries,
    artifacts,
  }) as unknown as ProtocolDeploymentContract;
  const routes = new Set<string>();
  for (const [queryIndex, query] of queries.entries()) {
    const route = `${query.endpoint.method}\0${query.endpoint.path}`;
    if (routes.has(route)) {
      deploymentError(
        'HQ_DEPLOYMENT_INVALID_VALUE',
        `$.queries[${queryIndex}].endpoint`,
      );
    }
    routes.add(route);
  }
  validateReferences(result);
  return result;
}
