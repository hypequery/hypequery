import { expressionError } from '../expressions/errors.js';

export type DataRecord = Record<string, unknown>;

/** A plain data object: no custom prototype, symbols, accessors or hidden keys. */
export function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    expressionError('HQ_EXPRESSION_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
    }
  }
  return input as DataRecord;
}

/** A dense plain array of at most `maximum` items. */
export function requireArray(input: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(input)) expressionError('HQ_EXPRESSION_TYPE', path);
  if (Object.getPrototypeOf(input) !== Array.prototype || Object.getOwnPropertySymbols(input).length > 0) {
    expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', `${path}[${index}]`);
    }
  }
  if (Object.keys(input).length !== input.length) expressionError('HQ_EXPRESSION_UNSAFE_OBJECT', path);
  if (input.length > maximum) expressionError('HQ_EXPRESSION_TOO_MANY_ITEMS', path);
  return input;
}

/** Closed records: unknown members and missing required ones both fail. */
export function exactFields(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) expressionError('HQ_EXPRESSION_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) expressionError('HQ_EXPRESSION_TYPE', `${path}.${key}`);
  }
}

export function freezeRecord(entries: DataRecord): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}
