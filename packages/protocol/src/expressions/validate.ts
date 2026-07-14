import {
  ProtocolIdentifierError,
  parseProtocolIdentifier,
  parseProtocolQualifiedIdentifier,
} from '../identifiers/index.js';
import { ProtocolValueError, validateCanonicalValue } from '../values/index.js';
import { expressionError } from './errors.js';
import { resolveExpressionLimits } from './limits.js';
import type {
  ProtocolAggregation,
  ProtocolExpression,
  ProtocolExpressionLimits,
  ProtocolExpressionOptions,
  ProtocolSemanticQuery,
} from './types.js';

type DataRecord = Record<string, unknown>;

interface State {
  readonly limits: Readonly<ProtocolExpressionLimits>;
  readonly active: WeakSet<object>;
  nodes: number;
}

const BINARY = new Set(['add', 'subtract', 'multiply', 'divide']);
const COMPARISONS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like']);
const AGGREGATIONS = new Set<ProtocolAggregation>([
  'sum', 'count', 'countDistinct', 'avg', 'min', 'max',
  'argMax', 'argMin', 'percentile', 'stddev', 'variance',
]);
const GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const CALL_ARITY: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  nullIfZero: [1, 1],
  coalesce: [2, 2],
  round: [1, 2],
  floor: [1, 1],
  ceil: [1, 1],
});

function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    expressionError('HQ_EXPRESSION_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.getOwnPropertySymbols(input).length > 0) {
    expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
    }
  }
  return input as DataRecord;
}

function exactFields(value: DataRecord, required: readonly string[], optional: readonly string[], path: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) expressionError('HQ_EXPRESSION_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) expressionError('HQ_EXPRESSION_TYPE', `${path}.${key}`);
  }
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') expressionError('HQ_EXPRESSION_TYPE', path);
  return value;
}

function identifier(value: unknown, path: string, qualified = true): string {
  try {
    return qualified ? parseProtocolQualifiedIdentifier(value) : parseProtocolIdentifier(value);
  } catch (error) {
    if (error instanceof ProtocolIdentifierError) {
      expressionError('HQ_EXPRESSION_INVALID_IDENTIFIER', path);
    }
    throw error;
  }
}

function enter(value: object, depth: number, state: State, path: string): void {
  if (depth > state.limits.maxDepth) expressionError('HQ_EXPRESSION_TOO_DEEP', path);
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) expressionError('HQ_EXPRESSION_TOO_MANY_NODES', path);
  if (state.active.has(value)) expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  state.active.add(value);
}

function arrayValue(value: unknown, path: string, state: State): readonly unknown[] {
  if (!Array.isArray(value)) expressionError('HQ_EXPRESSION_TYPE', path);
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  }
  if (value.length > state.limits.maxCollectionItems) expressionError('HQ_EXPRESSION_TOO_MANY_ITEMS', path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', `${path}[${index}]`);
    }
  }
  if (Object.keys(value).length !== value.length) {
    expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  }
  return value;
}

function freezeRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function validateExpression(input: unknown, path: string, depth: number, state: State): ProtocolExpression {
  const value = requireRecord(input, path);
  enter(value, depth, state, path);
  try {
    const kind = stringValue(value.kind, `${path}.kind`);
    switch (kind) {
      case 'reference': {
        exactFields(value, ['kind', 'name'], [], path);
        return freezeRecord({ kind, name: identifier(value.name, `${path}.name`) }) as ProtocolExpression;
      }
      case 'literal': {
        exactFields(value, ['kind', 'value'], [], path);
        try {
          return freezeRecord({ kind, value: validateCanonicalValue(value.value) }) as ProtocolExpression;
        } catch (error) {
          if (error instanceof ProtocolValueError) expressionError('HQ_EXPRESSION_INVALID_VALUE', `${path}.value`);
          throw error;
        }
      }
      case 'binary': {
        exactFields(value, ['kind', 'operator', 'left', 'right'], [], path);
        const operator = stringValue(value.operator, `${path}.operator`);
        if (!BINARY.has(operator)) expressionError('HQ_EXPRESSION_INVALID_OPERATOR', `${path}.operator`);
        return freezeRecord({
          kind,
          operator,
          left: validateExpression(value.left, `${path}.left`, depth + 1, state),
          right: validateExpression(value.right, `${path}.right`, depth + 1, state),
        }) as ProtocolExpression;
      }
      case 'call': {
        exactFields(value, ['kind', 'function', 'args'], [], path);
        const fn = stringValue(value.function, `${path}.function`);
        const arity = CALL_ARITY[fn];
        if (!arity) expressionError('HQ_EXPRESSION_INVALID_OPERATOR', `${path}.function`);
        const args = arrayValue(value.args, `${path}.args`, state);
        if (args.length < arity[0] || args.length > arity[1]) {
          expressionError('HQ_EXPRESSION_INVALID_ARITY', `${path}.args`);
        }
        return freezeRecord({
          kind,
          function: fn,
          args: Object.freeze(args.map((arg, index) => validateExpression(arg, `${path}.args[${index}]`, depth + 1, state))),
        }) as ProtocolExpression;
      }
      case 'comparison': {
        exactFields(value, ['kind', 'operator', 'left', 'right'], [], path);
        const operator = stringValue(value.operator, `${path}.operator`);
        if (!COMPARISONS.has(operator)) expressionError('HQ_EXPRESSION_INVALID_OPERATOR', `${path}.operator`);
        const left = validateExpression(value.left, `${path}.left`, depth + 1, state);
        const right = validateExpression(value.right, `${path}.right`, depth + 1, state);
        validateComparisonOperands(operator, right, `${path}.right`);
        return freezeRecord({
          kind,
          operator,
          left,
          right,
        }) as ProtocolExpression;
      }
      case 'logical': {
        exactFields(value, ['kind', 'operator'], ['operand', 'operands'], path);
        const operator = stringValue(value.operator, `${path}.operator`);
        if (operator === 'not') {
          if (!Object.hasOwn(value, 'operand') || Object.hasOwn(value, 'operands')) {
            expressionError('HQ_EXPRESSION_INVALID_ARITY', path);
          }
          return freezeRecord({ kind, operator, operand: validateExpression(value.operand, `${path}.operand`, depth + 1, state) }) as ProtocolExpression;
        }
        if (operator !== 'and' && operator !== 'or') expressionError('HQ_EXPRESSION_INVALID_OPERATOR', `${path}.operator`);
        if (!Object.hasOwn(value, 'operands') || Object.hasOwn(value, 'operand')) {
          expressionError('HQ_EXPRESSION_INVALID_ARITY', path);
        }
        const operands = arrayValue(value.operands, `${path}.operands`, state);
        if (operands.length < 2) expressionError('HQ_EXPRESSION_INVALID_ARITY', `${path}.operands`);
        return freezeRecord({
          kind,
          operator,
          operands: Object.freeze(operands.map((operand, index) => validateExpression(operand, `${path}.operands[${index}]`, depth + 1, state))),
        }) as ProtocolExpression;
      }
      case 'aggregate':
        return validateAggregate(value, path, depth, state);
      default:
        expressionError('HQ_EXPRESSION_UNKNOWN_KIND', `${path}.kind`);
    }
  } finally {
    state.active.delete(value);
  }
}

function validateComparisonOperands(operator: string, right: ProtocolExpression, path: string): void {
  if (operator === 'like') {
    if (right.kind !== 'literal' || typeof right.value !== 'string') {
      expressionError('HQ_EXPRESSION_INVALID_VALUE', path);
    }
    return;
  }
  if (operator !== 'in' && operator !== 'notIn' && operator !== 'between') return;
  if (right.kind !== 'literal' || typeof right.value !== 'object' || right.value === null
    || !('$hypequery' in right.value)) {
    expressionError('HQ_EXPRESSION_INVALID_VALUE', path);
  }
  const tag = right.value.$hypequery;
  const expectedType = operator === 'between' ? 'tuple' : 'array';
  if (tag.type !== expectedType || !('values' in tag)) {
    expressionError('HQ_EXPRESSION_INVALID_VALUE', path);
  }
  const requiredLength = operator === 'between' ? 2 : undefined;
  if (tag.values.length === 0 || (requiredLength !== undefined && tag.values.length !== requiredLength)) {
    expressionError('HQ_EXPRESSION_INVALID_ARITY', path);
  }
}

function validateAggregate(value: DataRecord, path: string, depth: number, state: State): ProtocolExpression {
  exactFields(value, ['kind', 'aggregation', 'field'], ['argField', 'level', 'filters'], path);
  const aggregation = stringValue(value.aggregation, `${path}.aggregation`) as ProtocolAggregation;
  if (!AGGREGATIONS.has(aggregation)) expressionError('HQ_EXPRESSION_INVALID_AGGREGATION', `${path}.aggregation`);
  const isArg = aggregation === 'argMax' || aggregation === 'argMin';
  const isPercentile = aggregation === 'percentile';
  if (isArg !== Object.hasOwn(value, 'argField') || isPercentile !== Object.hasOwn(value, 'level')) {
    expressionError('HQ_EXPRESSION_INVALID_AGGREGATION', path);
  }
  if (isArg && Object.hasOwn(value, 'filters')) expressionError('HQ_EXPRESSION_INVALID_AGGREGATION', `${path}.filters`);
  const level = value.level;
  if (isPercentile && (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1)) {
    expressionError('HQ_EXPRESSION_INVALID_AGGREGATION', `${path}.level`);
  }
  const filters = value.filters === undefined ? undefined : arrayValue(value.filters, `${path}.filters`, state);
  return freezeRecord({
    kind: 'aggregate',
    aggregation,
    field: identifier(value.field, `${path}.field`),
    ...(isArg ? { argField: identifier(value.argField, `${path}.argField`) } : {}),
    ...(isPercentile ? { level } : {}),
    ...(filters ? {
      filters: Object.freeze(filters.map((filter, index) => validatePredicate(
        filter,
        `${path}.filters[${index}]`,
        depth + 1,
        state,
        'HQ_EXPRESSION_INVALID_AGGREGATION',
      ))),
    } : {}),
  }) as ProtocolExpression;
}

function newState(options: ProtocolExpressionOptions): State {
  return { limits: resolveExpressionLimits(options), active: new WeakSet(), nodes: 0 };
}

export function validateProtocolExpression(
  input: unknown,
  options: ProtocolExpressionOptions = {},
): ProtocolExpression {
  return validateExpression(input, '$', 1, newState(options));
}

export function validateProtocolSemanticQuery(
  input: unknown,
  options: ProtocolExpressionOptions = {},
): ProtocolSemanticQuery {
  const state = newState(options);
  const value = requireRecord(input, '$');
  enter(value, 1, state, '$');
  try {
    const kind = stringValue(value.kind, '$.kind');
    const metric = kind === 'metric';
    if (!metric && kind !== 'dataset') expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.kind');
    exactFields(
      value,
      metric ? ['kind', 'dataset', 'metric'] : ['kind', 'dataset'],
      metric
        ? ['dimensions', 'filters', 'orderBy', 'limit', 'offset', 'by', 'includeMeta']
        : ['dimensions', 'measures', 'filters', 'orderBy', 'limit', 'offset', 'by', 'includeMeta'],
      '$',
    );
    const result: Record<string, unknown> = {
      kind,
      dataset: identifier(value.dataset, '$.dataset', false),
      ...(metric ? { metric: identifier(value.metric, '$.metric', false) } : {}),
    };
    copyIdentifierArray(value, result, 'dimensions', true, state);
    if (!metric) copyIdentifierArray(value, result, 'measures', false, state);
    if (value.filters !== undefined) {
      const filters = arrayValue(value.filters, '$.filters', state);
      result.filters = Object.freeze(filters.map((filter, index) => validatePredicate(
        filter,
        `$.filters[${index}]`,
        2,
        state,
        'HQ_EXPRESSION_INVALID_QUERY',
      )));
    }
    if (value.orderBy !== undefined) result.orderBy = validateOrderBy(value.orderBy, state);
    copyInteger(value, result, 'limit', 0);
    copyInteger(value, result, 'offset', 0);
    if (value.by !== undefined) {
      const grain = stringValue(value.by, '$.by');
      if (!GRAINS.has(grain)) expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.by');
      result.by = grain;
    }
    if (value.includeMeta !== undefined) {
      if (typeof value.includeMeta !== 'boolean') expressionError('HQ_EXPRESSION_INVALID_QUERY', '$.includeMeta');
      result.includeMeta = value.includeMeta;
    }
    return freezeRecord(result) as unknown as ProtocolSemanticQuery;
  } finally {
    state.active.delete(value);
  }
}

function validatePredicate(
  input: unknown,
  path: string,
  depth: number,
  state: State,
  errorCode: 'HQ_EXPRESSION_INVALID_AGGREGATION' | 'HQ_EXPRESSION_INVALID_QUERY',
): ProtocolExpression {
  const expression = validateExpression(input, path, depth, state);
  if (!isPredicate(expression)) expressionError(errorCode, path);
  return expression;
}

function isPredicate(expression: ProtocolExpression): boolean {
  if (expression.kind === 'comparison') return true;
  if (expression.kind !== 'logical') return false;
  return expression.operator === 'not'
    ? isPredicate(expression.operand)
    : expression.operands.every(isPredicate);
}

function copyIdentifierArray(
  source: DataRecord,
  target: Record<string, unknown>,
  key: string,
  qualified: boolean,
  state: State,
): void {
  if (source[key] === undefined) return;
  const values = arrayValue(source[key], `$.${key}`, state);
  target[key] = Object.freeze(values.map((item, index) => identifier(item, `$.${key}[${index}]`, qualified)));
}

function copyInteger(source: DataRecord, target: Record<string, unknown>, key: string, minimum: number): void {
  if (source[key] === undefined) return;
  const value = source[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    expressionError('HQ_EXPRESSION_INVALID_QUERY', `$.${key}`);
  }
  target[key] = value;
}

function validateOrderBy(input: unknown, state: State): readonly DataRecord[] {
  const values = arrayValue(input, '$.orderBy', state);
  return Object.freeze(values.map((item, index) => {
    const path = `$.orderBy[${index}]`;
    const value = requireRecord(item, path);
    exactFields(value, ['field', 'direction'], [], path);
    const direction = stringValue(value.direction, `${path}.direction`);
    if (direction !== 'asc' && direction !== 'desc') expressionError('HQ_EXPRESSION_INVALID_QUERY', `${path}.direction`);
    return freezeRecord({ field: identifier(value.field, `${path}.field`), direction });
  }));
}
