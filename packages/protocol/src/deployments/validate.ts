import { validateProtocolRowResolution } from './row-resolution.js';
import { ProtocolExpressionError, validateProtocolExpression } from '../expressions/index.js';
import type { ProtocolExpression } from '../expressions/index.js';
import {
  ProtocolIdentifierError,
  parseProtocolIdentifier,
  parseProtocolQualifiedIdentifier,
} from '../identifiers/index.js';
import { ProtocolQueryImplementationError } from '../query-implementations/errors.js';
import { validateProtocolSqlExpression } from '../sql-expressions/validate.js';
import { DeploymentErrorCollector, attempt, collectErrors } from './collect.js';
import { deploymentError } from './errors.js';
import { expressionReferences, isSegmentPredicate, isSegmentReference } from './segments.js';
import { resolveDeploymentLimits } from './limits.js';
import type {
  ProtocolAccessPolicy,
  ProtocolDatasetContract,
  ProtocolDatasetDerivedMeasure,
  ProtocolDeploymentCheckResult,
  ProtocolDeploymentContract,
  ProtocolDeploymentContractV3,
  ProtocolDeploymentDataset,
  ProtocolDeploymentDatasetV3,
  ProtocolDeploymentErrorCode,
  ProtocolDatasetSegment,
  ProtocolDeploymentMeasure,
  ProtocolDatasetDimension,
  ProtocolDatasetFieldSource,
  ProtocolDatasetFilter,
  ProtocolDatasetLimits,
  ProtocolDatasetMeasure,
  ProtocolDatasetMetric,
  ProtocolDatasetRelationship,
  ProtocolMetricDerivation,
  ProtocolDatasetTenantPolicy,
  ProtocolDeploymentLimits,
  ProtocolDeploymentOptions,
  ProtocolEndpointPolicy,
  ProtocolEndpointTenantPolicy,
} from './types.js';

type DataRecord = Record<string, unknown>;
/** Deployment contract version being validated; 3 is RFC 0015. */
type ContractVersion = 2 | 3;
const textEncoder = new TextEncoder();
const AGGREGATIONS = new Set([
  'sum', 'count', 'countDistinct', 'avg', 'min', 'max',
  'argMax', 'argMin', 'percentile', 'stddev', 'variance',
]);
const AGGREGATIONS_V3 = new Set([...AGGREGATIONS, 'approxCountDistinct']);
const APPROXIMATE_AGGREGATIONS = new Set(['approxCountDistinct']);
const OPERATORS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like',
]);
const GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const GRAINS_V3 = new Set(['minute', 'hour', ...GRAINS]);
const SUB_DAY_GRAINS = new Set(['minute', 'hour']);
/** Aggregations a `cumulative` window may wrap: a running total of bucket partials. */
const CUMULATIVE_AGGREGATIONS = new Set(['sum', 'count', 'min', 'max']);
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
  if (Object.keys(input).length !== input.length
    || Object.getOwnPropertyNames(input).length !== input.length + 1) {
    deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  }
  return input;
}

function exactFields(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  issues?: DeploymentErrorCollector,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) attempt(issues, () => deploymentError('HQ_DEPLOYMENT_UNKNOWN_FIELD', `${path}.${key}`));
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) attempt(issues, () => deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.${key}`));
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
  issues?: DeploymentErrorCollector,
): void {
  const parseText = (item: unknown, itemPath: string) => (
    boundedText(item, itemPath, limits.maxTextBytes)
  );
  // Each metadata field is independent, so each is its own recovery point.
  for (const key of ['examples', 'synonyms'] as const) {
    if (value[key] !== undefined) {
      attempt(issues, () => {
        result[key] = uniqueStrings(
          value[key], `${path}.${key}`, limits.maxSemanticMetadataItems, parseText,
        );
      });
    }
  }
  for (const key of ['format', 'unit', 'timezone'] as const) {
    attempt(issues, () => optionalText(value[key], key, result, path, limits));
  }
  if (value.currency !== undefined) {
    attempt(issues, () => {
      const currency = boundedText(value.currency, `${path}.currency`, limits.maxTextBytes);
      if (!/^[A-Z]{3}$/.test(currency)) {
        deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.currency`);
      }
      result.currency = currency;
    });
  }
  if (value.sensitivity !== undefined) {
    attempt(issues, () => {
      if (typeof value.sensitivity !== 'string' || !SENSITIVITIES.has(value.sensitivity)) {
        deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.sensitivity`);
      }
      result.sensitivity = value.sensitivity;
    });
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
): ProtocolEndpointPolicy {
  const value = requireRecord(input, path);
  exactFields(
    value,
    ['access', 'tenant'],
    ['cacheTtlMs', 'maxLimit', 'path'],
    path,
  );
  const result: Record<string, unknown> = {
    access: validateAccess(value.access, `${path}.access`, limits),
    tenant: validateEndpointTenant(value.tenant, `${path}.tenant`, limits),
  };
  if (value.cacheTtlMs !== undefined) result.cacheTtlMs = positiveInteger(value.cacheTtlMs, `${path}.cacheTtlMs`);
  if (value.maxLimit !== undefined) result.maxLimit = positiveInteger(value.maxLimit, `${path}.maxLimit`);
  if (value.path !== undefined) {
    const endpointPath = boundedText(value.path, `${path}.path`, limits.maxPathBytes);
    if (!endpointPath.startsWith('/')) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.path`);
    result.path = endpointPath;
  }
  return freezeRecord(result) as unknown as ProtocolEndpointPolicy;
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
    if (error instanceof ProtocolExpressionError) {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
    }
    // RFC 0006 keeps the SQL envelope's own code; only the location is rebased
    // from the envelope root onto the contract.
    if (error instanceof ProtocolQueryImplementationError) {
      throw new ProtocolQueryImplementationError(error.code, `${path}${error.path.slice(1)}`);
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
  version: ContractVersion = 2,
): ProtocolDatasetMeasure {
  const value = requireRecord(input, path);
  exactFields(
    value,
    ['name', 'aggregation', 'field', 'filters'],
    [
      'argField', 'level', 'sql', 'label', 'description', ...SEMANTIC_METADATA_FIELDS,
      ...(version === 3 ? ['approximate'] : []),
    ],
    path,
  );
  if (typeof value.aggregation !== 'string'
    || !(version === 3 ? AGGREGATIONS_V3 : AGGREGATIONS).has(value.aggregation)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.aggregation`);
  }
  // The marker is not free: present, as `true`, exactly for an approximate aggregation.
  const approximate = APPROXIMATE_AGGREGATIONS.has(value.aggregation);
  if (value.approximate !== undefined && value.approximate !== true) {
    deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.approximate`);
  }
  if (approximate !== (value.approximate === true)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.approximate`);
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
        () => validateProtocolExpression(filter, { extension: version === 3 ? 2 : 1 }),
        `${path}.filters[${index}]`,
      ))),
  };
  if (approximate) result.approximate = true;
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
  limits: Readonly<ProtocolDeploymentLimits>,
): ProtocolDatasetRelationship {
  const value = requireRecord(input, path);
  exactFields(value, ['name', 'kind', 'target', 'from', 'to', 'queryable'], ['keys'], path);
  if (!['belongsTo', 'hasMany', 'hasOne'].includes(value.kind as string)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
  }
  if (typeof value.queryable !== 'boolean') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.queryable`);
  if ((value.kind === 'hasMany') === value.queryable) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.queryable`);
  }
  // Composite keys are physical columns; keep legacy identifier grammar unchanged.
  const from = identifier(value.from, `${path}.from`, value.keys === undefined);
  const to = identifier(value.to, `${path}.to`, value.keys === undefined);
  const keys = value.keys === undefined ? undefined : requireArray(value.keys, `${path}.keys`, limits.maxDatasetItems)
    .map((input, index) => {
      const keyPath = `${path}.keys[${index}]`;
      const key = requireRecord(input, keyPath);
      exactFields(key, ['from', 'to'], [], keyPath);
      return freezeRecord({ from: identifier(key.from, `${keyPath}.from`), to: identifier(key.to, `${keyPath}.to`) });
    });
  // `keys` is only for composite relationships: a single pair uses from/to.
  if (keys && (
    keys.length < 2 || keys[0].from !== from || keys[0].to !== to
    || new Set(keys.map(key => key.from)).size !== keys.length
    || new Set(keys.map(key => key.to)).size !== keys.length
  )) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.keys`);
  }
  return freezeRecord({
    name: identifier(value.name, `${path}.name`),
    kind: value.kind,
    target: identifier(value.target, `${path}.target`),
    from,
    to,
    ...(keys ? { keys: Object.freeze(keys) } : {}),
    queryable: value.queryable,
  }) as unknown as ProtocolDatasetRelationship;
}

/**
 * The subset of the expression grammar a derived metric's formula may use.
 *
 * `validateProtocolExpression` accepts the whole of RFC 0003, which is wider
 * than anything a formula can be written in: it permits comparisons, logical
 * operators, a bare aggregate, and a one-argument `round`. A `derivation` exists
 * to be rebuilt and executed, so accepting a form nothing can rebuild would
 * publish a contract that validates and then fails at the point of use. The
 * grammar is pinned here, in the artifact that defines the field, rather than
 * left to whichever runtime happens to read it.
 */
function validateFormulaGrammar(expression: unknown, path: string): void {
  const node = expression as DataRecord;
  const operand = (child: unknown, childPath: string) => validateFormulaGrammar(child, childPath);
  const numericLiteral = (child: unknown, childPath: string) => {
    const candidate = child as DataRecord;
    if (candidate?.kind !== 'literal' || typeof candidate.value !== 'number') {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', childPath);
    }
  };
  switch (node.kind) {
    case 'reference':
      return;
    case 'binary':
      // Arithmetic only, and never over a bare value: the authoring helpers
      // take a name or another expression, never a literal.
      if (!['add', 'subtract', 'multiply', 'divide'].includes(node.operator as string)) {
        deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.operator`);
      }
      operand(node.left, `${path}.left`);
      operand(node.right, `${path}.right`);
      return;
    case 'call': {
      const args = node.args as readonly unknown[];
      const expected = node.function === 'round' || node.function === 'coalesce' ? 2 : 1;
      if (!['nullIfZero', 'coalesce', 'round', 'floor', 'ceil'].includes(node.function as string)) {
        deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.function`);
      }
      if (args.length !== expected) {
        deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.args`);
      }
      operand(args[0], `${path}.args[0]`);
      if (node.function === 'round') numericLiteral(args[1], `${path}.args[1]`);
      // A `coalesce` fallback is the one position accepting a bare value.
      if (node.function === 'coalesce' && (args[1] as DataRecord)?.kind === 'literal') {
        numericLiteral(args[1], `${path}.args[1]`);
      } else if (node.function === 'coalesce') {
        operand(args[1], `${path}.args[1]`);
      }
      return;
    }
    default:
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
  }
}

/** Structural equality over two already-validated expressions. */
function sameExpression(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameExpression(item, right[index]));
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(right, key)
      && sameExpression((left as DataRecord)[key], (right as DataRecord)[key]));
}

/** Replaces each aliased reference with the aggregate the alias stands for. */
function substituteInputs(
  expression: unknown,
  inputs: ReadonlyMap<string, unknown>,
): unknown {
  if (Array.isArray(expression)) {
    return expression.map(item => substituteInputs(item, inputs));
  }
  if (typeof expression !== 'object' || expression === null) return expression;
  const record = expression as DataRecord;
  if (record.kind === 'reference' && typeof record.name === 'string' && inputs.has(record.name)) {
    return inputs.get(record.name);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, substituteInputs(value, inputs)]),
  );
}

/**
 * Validates the authored form of a derived metric's formula.
 *
 * Input order is significant and deliberately not sorted: each input becomes a
 * column of the intermediate aggregate in this order, so reordering them
 * reorders the emitted SQL. Two datasets that differ only in input order are
 * genuinely different contracts.
 */
function validateDerivation(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
  inlined: unknown,
): ProtocolMetricDerivation {
  const value = requireRecord(input, path);
  exactFields(value, ['inputs', 'expression'], [], path);
  const items = requireArray(value.inputs, `${path}.inputs`, limits.maxDatasetItems);
  if (items.length === 0) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.inputs`);

  const seen = new Set<string>();
  const inputs = items.map((item, index) => {
    const itemPath = `${path}.inputs[${index}]`;
    const record = requireRecord(item, itemPath);
    exactFields(record, ['alias', 'expression'], [], itemPath);
    const alias = identifier(record.alias, `${itemPath}.alias`);
    if (seen.has(alias)) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${itemPath}.alias`);
    seen.add(alias);
    const expression = nested(
      () => validateProtocolExpression(record.expression),
      `${itemPath}.expression`,
    );
    // Only an aggregate can become a column of the intermediate result. A
    // formula that named something else has no faithful rebuild.
    if ((expression as DataRecord).kind !== 'aggregate') {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${itemPath}.expression`);
    }
    return freezeRecord({ alias, expression });
  });

  const expression = nested(
    () => validateProtocolExpression(value.expression),
    `${path}.expression`,
  );
  validateFormulaGrammar(expression, `${path}.expression`);
  // A formula that is a bare reference names one of its inputs instead of
  // combining them. The authoring API cannot produce it — a formula must return
  // a composed expression — so nothing could rebuild it.
  if ((expression as DataRecord).kind === 'reference') {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.expression`);
  }
  // The two forms must describe one formula. Substituting the inputs back into
  // the authored form has to reproduce the inlined one exactly, or the contract
  // advertises a meaning its aliases do not compute.
  const substituted = substituteInputs(
    expression,
    new Map(inputs.map(entry => [entry.alias as string, entry.expression])),
  );
  if (!sameExpression(substituted, inlined)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', `${path}.expression`);
  }
  return freezeRecord({
    inputs: Object.freeze(inputs),
    expression,
  }) as unknown as ProtocolMetricDerivation;
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
    ['grain', 'derivation', 'label', 'description', ...SEMANTIC_METADATA_FIELDS],
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
  if (value.derivation !== undefined) {
    // Eligibility follows the expression, not `kind`. `kind` conflates grain
    // with derivation — a derived metric pinned to a grain reports
    // `grained-metric` — so it can neither confirm nor deny that a formula
    // exists. A metric whose expression is a bare aggregate has none, whatever
    // its kind says, and a derivation attached to one describes something the
    // metric does not do.
    if ((result.expression as DataRecord).kind === 'aggregate') {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.derivation`);
    }
    result.derivation = validateDerivation(
      value.derivation,
      `${path}.derivation`,
      limits,
      result.expression,
    );
  }
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
  version: ContractVersion,
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
    if (typeof value.timeGrain !== 'string' || !(version === 3 ? GRAINS_V3 : GRAINS).has(value.timeGrain)) {
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
  validate: (value: unknown, path: string, index: number) => T,
  issues?: DeploymentErrorCollector,
): readonly T[] {
  const since = issues?.count ?? 0;
  const items = requireArray(input, path, maxItems)
    .map((value, index) => attempt(issues, () => validate(value, `${path}[${index}]`, index)) as T);
  // Name checks over a partial list would report the failed items again.
  issues?.checkpoint(since);
  if (new Set(items.map(item => item.name)).size !== items.length) {
    deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', path);
  }
  return Object.freeze(items);
}

function validateSegment(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
  dimensions: readonly ProtocolDatasetDimension[],
  tenant: ProtocolDatasetTenantPolicy,
): ProtocolDatasetSegment {
  const value = requireRecord(input, path);
  exactFields(value, ['name', 'predicate'], ['label', 'description', ...SEMANTIC_METADATA_FIELDS], path);
  const name = identifier(value.name, `${path}.name`);
  const predicate = nested(
    () => validateProtocolExpression(value.predicate, { extension: 2 }),
    `${path}.predicate`,
  );
  if (!isSegmentPredicate(predicate)
    || expressionReferences(predicate).some(reference => !isSegmentReference(reference, dimensions, tenant))) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.predicate`);
  }
  const result: Record<string, unknown> = { name, predicate };
  optionalText(value.label, 'label', result, path, limits);
  optionalText(value.description, 'description', result, path, limits);
  validateSemanticMetadata(value, result, path, limits);
  return freezeRecord(result) as unknown as ProtocolDatasetSegment;
}

function validateDataset(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
  measureIndices?: readonly number[],
  version: ContractVersion = 2,
  issues?: DeploymentErrorCollector,
): ProtocolDatasetContract {
  const since = issues?.count ?? 0;
  const field = <T>(action: () => T): T => attempt(issues, action) as T;
  const value = requireRecord(input, path);
  // Contract 3 renames the allow-list; the old name is then an unknown field.
  const filtersKey = version === 3 ? 'allowedFilters' : 'filters';
  exactFields(
    value,
    [
      'name', 'source', 'tenant', 'dimensions', 'measures', filtersKey, 'metrics', 'relationships',
    ],
    [
      'description', 'freshness', 'owner', 'defaults', 'rowResolution',
      ...SEMANTIC_METADATA_FIELDS,
      'timeField', 'limits', 'endpoint',
      ...(version === 3 ? ['segments'] : []),
    ],
    path,
    issues,
  );
  // Each field is a recovery point when collecting; without a collector
  // `field` is a plain call and the first failure throws.
  const result: Record<string, unknown> = {
    name: field(() => identifier(value.name, `${path}.name`)),
    source: field(() => boundedText(value.source, `${path}.source`, limits.maxSourceBytes)),
    tenant: field(() => validateTenant(value.tenant, `${path}.tenant`, limits)),
    dimensions: field(() => namedItems(
      value.dimensions, `${path}.dimensions`, limits.maxDatasetItems,
      (item, itemPath) => validateDimension(item, itemPath, limits),
      issues,
    )),
    measures: field(() => namedItems(
      value.measures, `${path}.measures`, limits.maxDatasetItems,
      (item, itemPath, index) => validateMeasure(
        item,
        measureIndices === undefined ? itemPath : `${path}.measures[${measureIndices[index]}]`,
        limits,
        version,
      ),
      issues,
    )),
    [filtersKey]: field(() => namedItems(
      value[filtersKey], `${path}.${filtersKey}`, limits.maxDatasetItems,
      (item, itemPath) => validateFilter(item, itemPath, limits),
      issues,
    )),
    metrics: field(() => namedItems(
      value.metrics, `${path}.metrics`, limits.maxDatasetItems,
      (item, itemPath) => validateMetric(item, itemPath, limits),
      issues,
    )),
    relationships: field(() => namedItems(
      value.relationships, `${path}.relationships`, limits.maxDatasetItems,
      (item, itemPath) => validateRelationship(item, itemPath, limits),
      issues,
    )),
  };
  // Segments resolve against the dimensions and tenant, so they wait for both.
  if (version === 3 && value.segments !== undefined
    && result.dimensions !== undefined && result.tenant !== undefined) {
    result.segments = field(() => namedItems(
      value.segments, `${path}.segments`, limits.maxDatasetItems,
      (item, itemPath) => validateSegment(
        item,
        itemPath,
        limits,
        result.dimensions as readonly ProtocolDatasetDimension[],
        result.tenant as ProtocolDatasetTenantPolicy,
      ),
      issues,
    ));
  }
  if (value.rowResolution !== undefined) {
    result.rowResolution = field(() => validateProtocolRowResolution(value.rowResolution, `${path}.rowResolution`));
  }
  if (value.timeField !== undefined) {
    result.timeField = field(() => identifier(value.timeField, `${path}.timeField`, true));
  }
  field(() => optionalText(value.description, 'description', result, path, limits));
  field(() => optionalText(value.owner, 'owner', result, path, limits));
  validateSemanticMetadata(value, result, path, limits, issues);
  if (value.freshness !== undefined) {
    result.freshness = field(() => validateFreshness(value.freshness, `${path}.freshness`));
  }
  if (value.defaults !== undefined) {
    result.defaults = field(() => validateDefaults(value.defaults, `${path}.defaults`, limits, version));
  }
  if (value.limits !== undefined) result.limits = field(() => validateLimits(value.limits, `${path}.limits`));
  if (value.endpoint !== undefined) {
    result.endpoint = field(() => validateEndpoint(value.endpoint, `${path}.endpoint`, limits));
  }
  issues?.checkpoint(since);
  return freezeRecord(result) as unknown as ProtocolDatasetContract;
}

export function validateProtocolDatasetContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): ProtocolDatasetContract {
  return validateDataset(input, '$', resolveDeploymentLimits(options));
}

/**
 * Check a dataset contract and report every failure found, instead of
 * throwing the first. Accepts exactly what `validateProtocolDatasetContract` accepts.
 */
export function checkProtocolDatasetContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): ProtocolDeploymentCheckResult<ProtocolDatasetContract> {
  const limits = resolveDeploymentLimits(options);
  return collectErrors(issues => validateDataset(input, '$', limits, undefined, 2, issues));
}

function validateDatasetReferences(
  datasets: readonly ProtocolDeploymentDataset[],
  issues?: DeploymentErrorCollector,
): void {
  const names = new Set(datasets.map(dataset => dataset.name));
  const reference = (path: string) => attempt(issues, () => deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', path));
  for (const [index, dataset] of datasets.entries()) {
    if (dataset.defaults?.dimensions?.some(name => (
      !dataset.dimensions.some(dimension => dimension.name === name && dimension.groupable)
    ))) {
      reference(`$.datasets[${index}].defaults.dimensions`);
    }
    if (dataset.defaults?.timeGrain !== undefined && dataset.timeField === undefined) {
      reference(`$.datasets[${index}].defaults.timeGrain`);
    }
    for (const [relationshipIndex, relationship] of dataset.relationships.entries()) {
      if (!names.has(relationship.target)) {
        reference(`$.datasets[${index}].relationships[${relationshipIndex}].target`);
      }
    }
    if (dataset.endpoint !== undefined
      && (dataset.tenant.kind === 'required') !== (dataset.endpoint.tenant.kind === 'required')) {
      reference(`$.datasets[${index}].endpoint.tenant`);
    }
  }
}
function formulaReferences(expression: ProtocolExpression, names: Set<string>): void {
  switch (expression.kind) {
    case 'reference':
      names.add(expression.name);
      return;
    case 'binary':
      formulaReferences(expression.left, names);
      formulaReferences(expression.right, names);
      return;
    case 'call':
      expression.args.forEach(argument => formulaReferences(argument, names));
      return;
    default:
      // validateFormulaGrammar has already rejected every other node.
      return;
  }
}

function validateDatasetDerivedMeasure(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
  version: ContractVersion,
): ProtocolDatasetDerivedMeasure {
  const value = requireRecord(input, path);
  exactFields(value, ['kind', 'name', 'uses', 'expression'], [
    'label', 'description', ...SEMANTIC_METADATA_FIELDS,
    ...(version === 3 ? ['approximate'] : []),
  ], path);
  if (value.approximate !== undefined && value.approximate !== true) {
    deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.approximate`);
  }
  if (value.kind !== 'derived') deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
  const uses = requireArray(value.uses, `${path}.uses`, limits.maxDatasetItems)
    .map((inputUse, index) => {
      const usePath = `${path}.uses[${index}]`;
      const use = requireRecord(inputUse, usePath);
      exactFields(use, ['alias', 'measure'], [], usePath);
      return freezeRecord({
        alias: identifier(use.alias, `${usePath}.alias`),
        measure: identifier(use.measure, `${usePath}.measure`),
      });
    });
  if (uses.length === 0 || new Set(uses.map(use => use.alias)).size !== uses.length) {
    deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', `${path}.uses`);
  }
  const expression = nested(
    () => validateProtocolExpression(value.expression), `${path}.expression`,
  );
  validateFormulaGrammar(expression, `${path}.expression`);
  if (expression.kind === 'reference') {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.expression`);
  }
  const references = new Set<string>();
  formulaReferences(expression, references);
  if (references.size !== uses.length || uses.some(use => !references.has(use.alias as string))) {
    deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', `${path}.expression`);
  }
  const result: Record<string, unknown> = {
    kind: 'derived',
    name: identifier(value.name, `${path}.name`),
    uses: Object.freeze(uses),
    expression,
  };
  // Checked against the base measures by the dataset, once they are known.
  if (value.approximate === true) result.approximate = true;
  optionalText(value.label, 'label', result, path, limits);
  optionalText(value.description, 'description', result, path, limits);
  validateSemanticMetadata(value, result, path, limits);
  return freezeRecord(result) as unknown as ProtocolDatasetDerivedMeasure;
}

function validateInterval(input: unknown, path: string): DataRecord {
  const value = requireRecord(input, path);
  exactFields(value, ['amount', 'unit'], [], path);
  const amount = positiveInteger(value.amount, `${path}.amount`);
  if (typeof value.unit !== 'string' || !GRAINS_V3.has(value.unit)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.unit`);
  }
  return freezeRecord({ amount, unit: value.unit });
}

/**
 * Validates the shape of a contract 3 `window` or `shift` measure. Rules that
 * need the rest of the dataset (the wrapped base measure, the time field, and
 * approximation) are checked by the dataset. Rules that need the query grain
 * (whole-bucket intervals, the bucket bound) are enforced at query time.
 */
function validateTimeMeasure(
  value: DataRecord,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
): DataRecord {
  const window = value.kind === 'window';
  exactFields(
    value,
    window
      ? ['kind', 'name', 'measure', 'requiresTimeRange']
      : ['kind', 'name', 'measure', 'interval', 'requiresTimeRange'],
    [
      ...(window ? ['trailing', 'toDate', 'cumulative'] : []),
      'approximate', 'label', 'description', ...SEMANTIC_METADATA_FIELDS,
    ],
    path,
  );
  if (value.approximate !== undefined && value.approximate !== true) {
    deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.approximate`);
  }
  if (value.requiresTimeRange !== true) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.requiresTimeRange`);
  }
  const result: Record<string, unknown> = {
    kind: value.kind,
    name: identifier(value.name, `${path}.name`),
    measure: identifier(value.measure, `${path}.measure`),
    requiresTimeRange: true,
  };
  if (window) {
    const frames = ['trailing', 'toDate', 'cumulative'].filter(key => value[key] !== undefined);
    if (frames.length !== 1) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
    if (value.trailing !== undefined) result.trailing = validateInterval(value.trailing, `${path}.trailing`);
    if (value.toDate !== undefined) {
      // A to-date period must be coarser than some bucket, so `minute` has none.
      if (typeof value.toDate !== 'string' || !GRAINS_V3.has(value.toDate) || value.toDate === 'minute') {
        deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.toDate`);
      }
      result.toDate = value.toDate;
    }
    if (value.cumulative !== undefined) {
      if (value.cumulative !== true) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.cumulative`);
      result.cumulative = true;
    }
  } else {
    result.interval = validateInterval(value.interval, `${path}.interval`);
  }
  if (value.approximate === true) result.approximate = true;
  optionalText(value.label, 'label', result, path, limits);
  optionalText(value.description, 'description', result, path, limits);
  validateSemanticMetadata(value, result, path, limits);
  return freezeRecord(result);
}

function validateDeploymentDataset(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentLimits>,
  version: ContractVersion = 2,
  issues?: DeploymentErrorCollector,
): ProtocolDeploymentDataset {
  const since = issues?.count ?? 0;
  const value = requireRecord(input, path);
  exactFields(value,
    [
      'name', 'source', 'tenant', 'dimensions', 'measures',
      version === 3 ? 'allowedFilters' : 'filters', 'relationships',
    ],
    [
      'description', 'freshness', 'owner', 'defaults', 'rowResolution',
      ...SEMANTIC_METADATA_FIELDS, 'timeField', 'limits', 'endpoint',
      ...(version === 3 ? ['segments'] : []),
    ], path, issues);
  // When collecting, a malformed measure list is reported and the rest of the
  // dataset is still checked as if it had no measures; a malformed measure is
  // reported and its siblings are still checked.
  const records = attempt(issues, () => requireArray(value.measures, `${path}.measures`, limits.maxDatasetItems)) ?? [];
  const checked = records.map((measure, index) => (
    attempt(issues, () => requireRecord(measure, `${path}.measures[${index}]`))
  ));
  // Base measures are validated by the dataset; composite ones (derived, and in
  // contract 3 window and shift) reference them and are validated here.
  const isComposite = (measure: DataRecord) => measure.kind === 'derived'
    || (version === 3 && (measure.kind === 'window' || measure.kind === 'shift'));
  // Preserve original indices when validating base measures separately.
  const baseEntries = checked.flatMap((measure, index) => (
    measure === undefined || isComposite(measure) ? [] : [{ measure, index }]
  ));
  const validated = attempt(issues, () => validateDataset(
    { ...value, measures: baseEntries.map(entry => entry.measure), metrics: [] },
    path,
    limits,
    baseEntries.map(entry => entry.index),
    version,
    issues,
  ))!;
  const composite: (DataRecord | undefined)[] = checked.map((measure, index) => measure && attempt(issues, () => {
    const measurePath = `${path}.measures[${index}]`;
    if (measure.kind === 'derived') {
      return validateDatasetDerivedMeasure(measure, measurePath, limits, version) as unknown as DataRecord;
    }
    return isComposite(measure) ? validateTimeMeasure(measure, measurePath, limits) : undefined;
  }));
  // Cross-measure checks below assume every measure validated.
  issues?.checkpoint(since);
  const measures = checked as DataRecord[];
  // Independent cross-measure checks each recover; a check that needs a
  // reference that failed is skipped rather than reported again.
  const fail = (code: ProtocolDeploymentErrorCode, at: string) => attempt(issues, () => deploymentError(code, at));
  const derived = composite.map(item => (
    item?.kind === 'derived' ? item as unknown as ProtocolDatasetDerivedMeasure : undefined
  ));
  const baseByName = new Map<string, ProtocolDatasetMeasure>(validated.measures.map(measure => [measure.name, measure]));
  let baseIndex = 0;
  const ordered = measures.map((_, index) => (
    composite[index] ?? validated.measures[baseIndex++]!
  )) as unknown as ProtocolDeploymentMeasure[];
  if (new Set(ordered.map(measure => measure.name)).size !== measures.length) {
    fail('HQ_DEPLOYMENT_INVALID_REFERENCE', `${path}.measures`);
  }
  // Checks by name are ambiguous while names repeat.
  issues?.checkpoint(since);
  const isApproximate = (measure: unknown) => (measure as { approximate?: true } | undefined)?.approximate === true;
  // A time measure wraps exactly one base measure and needs the dataset's time axis.
  const timeByName = new Map<string, DataRecord>();
  // Time measures that failed a check still resolve by name, but checks that
  // read their properties would only repeat that failure.
  const failedTime = new Set<string>();
  for (const [index, item] of composite.entries()) {
    if (!item || item.kind === 'derived') continue;
    const timeMeasure = item;
    const before = issues?.count ?? 0;
    const measurePath = `${path}.measures[${index}]`;
    const wrapped = baseByName.get(timeMeasure.measure as string);
    if (!wrapped) fail('HQ_DEPLOYMENT_INVALID_REFERENCE', `${measurePath}.measure`);
    if (validated.timeField === undefined) fail('HQ_DEPLOYMENT_INVALID_REFERENCE', `${measurePath}.kind`);
    if (wrapped) {
      if (timeMeasure.cumulative === true && !CUMULATIVE_AGGREGATIONS.has(wrapped.aggregation)) {
        fail('HQ_DEPLOYMENT_INVALID_VALUE', `${measurePath}.cumulative`);
      }
      if (isApproximate(wrapped) !== isApproximate(timeMeasure)) {
        fail('HQ_DEPLOYMENT_INVALID_VALUE', `${measurePath}.approximate`);
      }
    }
    timeByName.set(timeMeasure.name as string, timeMeasure);
    if ((issues?.count ?? 0) > before) failedTime.add(timeMeasure.name as string);
  }
  for (const [index, item] of derived.entries()) {
    if (!item) continue;
    let resolved = true;
    for (const [useIndex, use] of item.uses.entries()) {
      if (!baseByName.has(use.measure) && !timeByName.has(use.measure)) {
        resolved = false;
        fail('HQ_DEPLOYMENT_INVALID_REFERENCE', `${path}.measures[${index}].uses[${useIndex}].measure`);
      }
    }
    if (!resolved || item.uses.some(use => failedTime.has(use.measure))) continue;
    const approximate = item.uses.some(use => (
      isApproximate(baseByName.get(use.measure) ?? timeByName.get(use.measure))
    ));
    if (approximate !== isApproximate(item)) {
      fail('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.measures[${index}].approximate`);
    }
  }
  issues?.checkpoint(since);
  const { metrics: _metrics, ...dataset } = validated;
  return freezeRecord({ ...dataset, measures: Object.freeze(ordered) }) as unknown as ProtocolDeploymentDataset;
}

function validateContract(
  input: unknown,
  limits: Readonly<ProtocolDeploymentLimits>,
  version: ContractVersion,
  issues?: DeploymentErrorCollector,
): readonly ProtocolDeploymentDataset[] {
  const value = requireRecord(input, '$');
  exactFields(value, ['kind', 'version', 'datasets'], [], '$', issues);
  attempt(issues, () => {
    if (value.kind !== 'hypequery-deployment') deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', '$.kind');
  });
  // Another version's rules do not apply, so its datasets are not worth checking.
  const since = issues?.count ?? 0;
  attempt(issues, () => {
    if (value.version !== version) deploymentError('HQ_DEPLOYMENT_INVALID_VERSION', '$.version');
  });
  issues?.checkpoint(since);
  const datasets = attempt(issues, () => namedItems(value.datasets, '$.datasets', limits.maxDatasets,
    (item, path) => validateDeploymentDataset(item, path, limits, version, issues), issues))!;
  // References between datasets need every dataset validated first.
  issues?.checkpoint(0);
  validateDatasetReferences(datasets, issues);
  return datasets;
}

/** Validate the deployment contract. Unsupported fields are forbidden, even when empty. */
export function validateProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): ProtocolDeploymentContract {
  return deploymentContract(validateContract(input, resolveDeploymentLimits(options), 2));
}

function deploymentContract(datasets: readonly ProtocolDeploymentDataset[]): ProtocolDeploymentContract {
  return freezeRecord({ kind: 'hypequery-deployment', version: 2, datasets }) as unknown as ProtocolDeploymentContract;
}

/**
 * Check a deployment contract and report every failure found, instead of
 * throwing the first. Accepts exactly what `validateProtocolDeploymentContract`
 * accepts, and returns the same value when it does.
 *
 * Failures are reported per independent part of the contract (each dataset,
 * collection item and dataset field). Checks that depend on a part that
 * already failed are skipped so one mistake is not reported several times.
 */
export function checkProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): ProtocolDeploymentCheckResult<ProtocolDeploymentContract> {
  const limits = resolveDeploymentLimits(options);
  return collectErrors(issues => deploymentContract(validateContract(input, limits, 2, issues)));
}

/** True when a contract 3 dataset uses anything contract 2 cannot express. */
function usesContract3Feature(dataset: ProtocolDeploymentDatasetV3): boolean {
  return (dataset.segments?.length ?? 0) > 0
    || dataset.measures.some(measure => (
      ('aggregation' in measure && APPROXIMATE_AGGREGATIONS.has(measure.aggregation))
      || ('kind' in measure && (measure.kind === 'window' || measure.kind === 'shift'))
    ))
    || (dataset.defaults?.timeGrain !== undefined && SUB_DAY_GRAINS.has(dataset.defaults.timeGrain));
}

/**
 * Validate a deployment contract 3 (RFC 0015). Contract 3 renames the dataset
 * filter allow-list to `allowedFilters` and adds segments, `approxCountDistinct`,
 * window and shift measures, and sub-day default grains.
 *
 * Under the lowest-version rule, a contract that uses none of those is only
 * valid as contract 2. Rejecting it here keeps a deployment's identity a
 * function of its content rather than of which producer emitted it.
 */
export function validateProtocolDeploymentContractV3(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): ProtocolDeploymentContractV3 {
  return deploymentContractV3(validateContract(input, resolveDeploymentLimits(options), 3));
}

/**
 * Check a deployment contract 3 and report every failure found, instead of
 * throwing the first. Accepts exactly what `validateProtocolDeploymentContractV3`
 * accepts; see `checkProtocolDeploymentContract` for how failures are grouped.
 */
export function checkProtocolDeploymentContractV3(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): ProtocolDeploymentCheckResult<ProtocolDeploymentContractV3> {
  const limits = resolveDeploymentLimits(options);
  return collectErrors(issues => deploymentContractV3(validateContract(input, limits, 3, issues)));
}

function deploymentContractV3(validated: readonly ProtocolDeploymentDataset[]): ProtocolDeploymentContractV3 {
  const datasets = validated as unknown as readonly ProtocolDeploymentDatasetV3[];
  if (!datasets.some(usesContract3Feature)) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VERSION', '$.version');
  }
  return freezeRecord({ kind: 'hypequery-deployment', version: 3, datasets }) as unknown as ProtocolDeploymentContractV3;
}
