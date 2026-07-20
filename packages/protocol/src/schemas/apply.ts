import type { CanonicalValue } from '../values/index.js';
import { resolveProtocolSchemaValueLimits } from './value-limits.js';
import type {
  ProtocolSchema,
  ProtocolSchemaValueLimits,
  ProtocolSchemaValueOptions,
} from './types.js';
import { validateProtocolSchema } from './validate.js';

type DataRecord = Record<string, unknown>;

export class ProtocolSchemaValueError extends Error {
  readonly code = 'HQ_SCHEMA_VALUE_INVALID' as const;

  constructor(readonly path: string) {
    super(`Value does not match the protocol schema at ${path}.`);
    this.name = 'ProtocolSchemaValueError';
  }
}

export interface ProtocolSchemaValueParser {
  parse(input: unknown): unknown;
}

interface State {
  readonly active: WeakSet<object>;
  readonly limits: Readonly<ProtocolSchemaValueLimits>;
  nodes: number;
}

const textEncoder = new TextEncoder();

function fail(path: string): never {
  throw new ProtocolSchemaValueError(path);
}

function enter(value: object, path: string, depth: number, state: State): void {
  if (depth > state.limits.maxDepth || state.active.has(value)) fail(path);
  state.active.add(value);
}

function stringValue(value: unknown, path: string, state: State): string {
  if (typeof value !== 'string' || value.length > state.limits.maxStringBytes
    || textEncoder.encode(value).byteLength > state.limits.maxStringBytes) fail(path);
  return value;
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ? `${path}.${key}` : `${path}.*`;
}

function record(value: unknown, path: string): DataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null
    || Object.getOwnPropertySymbols(value).length > 0) fail(path);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) fail(path);
  }
  return value as DataRecord;
}

function array(value: unknown, path: string, state: State): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Object.getOwnPropertySymbols(value).length > 0
    || value.length > state.limits.maxCollectionItems) fail(path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(`${path}[${index}]`);
  }
  if (Object.keys(value).length !== value.length) fail(path);
  return value;
}

function frozenRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function cloneAny(value: unknown, path: string, depth: number, state: State): unknown {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes || depth > state.limits.maxDepth) fail(path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return stringValue(value, path, state);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail(path);
    return value;
  }
  if (Array.isArray(value)) {
    const values = array(value, path, state);
    enter(value, path, depth, state);
    try {
      return Object.freeze(values.map((item, index) => (
        cloneAny(item, `${path}[${index}]`, depth + 1, state)
      )));
    } finally {
      state.active.delete(value);
    }
  }
  const source = record(value, path);
  if (Object.keys(source).length > state.limits.maxCollectionItems) fail(path);
  enter(source, path, depth, state);
  try {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(source)) {
      const itemPath = propertyPath(path, key);
      stringValue(key, itemPath, state);
      result[key] = cloneAny(item, itemPath, depth + 1, state);
    }
    return frozenRecord(result);
  } finally {
    state.active.delete(source);
  }
}

function canonicalToWire(value: CanonicalValue): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const tag = value.$hypequery;
  if (tag.type === 'array' || tag.type === 'tuple') return Object.freeze(tag.values.map(canonicalToWire));
  if (tag.type === 'map' && tag.entries.every(entry => typeof entry[0] === 'string')) {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, item] of tag.entries) result[key as string] = canonicalToWire(item);
    return frozenRecord(result);
  }
  return value;
}

function schemaDefault(schema: ProtocolSchema): CanonicalValue | undefined {
  return 'default' in schema ? schema.default : undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null
    || Array.isArray(left) || Array.isArray(right)) return false;
  const leftEntries = Object.entries(left);
  const rightRecord = right as DataRecord;
  return leftEntries.length === Object.keys(rightRecord).length
    && leftEntries.every(([key, value]) => Object.hasOwn(rightRecord, key)
      && sameValue(value, rightRecord[key]));
}

function apply(
  schema: ProtocolSchema,
  input: unknown,
  path: string,
  depth: number,
  state: State,
): unknown {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes || depth > state.limits.maxDepth) fail(path);
  let value = input;
  const defaultValue = schemaDefault(schema);
  if (value === undefined && defaultValue !== undefined) value = canonicalToWire(defaultValue);
  switch (schema.kind) {
    case 'void':
      if (value !== undefined) fail(path);
      return undefined;
    case 'any':
      if (value === undefined) fail(path);
      return cloneAny(value, path, depth, state);
    case 'null':
      if (value !== null) fail(path);
      return null;
    case 'boolean':
      if (typeof value !== 'boolean') fail(path);
      return value;
    case 'string': {
      const string = stringValue(value, path, state);
      const length = [...string].length;
      if (schema.minLength !== undefined && length < schema.minLength
        || schema.maxLength !== undefined && length > schema.maxLength) fail(path);
      return string;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
        || schema.kind === 'integer' && !Number.isSafeInteger(value)
        || schema.minimum !== undefined && value < schema.minimum
        || schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum
        || schema.maximum !== undefined && value > schema.maximum
        || schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fail(path);
      return value;
    }
    case 'literal': {
      const result = cloneAny(value, path, depth, state);
      if (!sameValue(result, canonicalToWire(schema.value))) fail(path);
      return result;
    }
    case 'enum': {
      const result = cloneAny(value, path, depth, state);
      if (!schema.values.some(candidate => sameValue(result, canonicalToWire(candidate)))) fail(path);
      return result;
    }
    case 'array': {
      const values = array(value, path, state);
      if (schema.minItems !== undefined && values.length < schema.minItems
        || schema.maxItems !== undefined && values.length > schema.maxItems) fail(path);
      enter(value as object, path, depth, state);
      try {
        return Object.freeze(values.map((item, index) => (
          apply(schema.items, item, `${path}[${index}]`, depth + 1, state)
        )));
      } finally {
        state.active.delete(value as object);
      }
    }
    case 'object': {
      const source = record(value, path);
      if (Object.keys(source).length > state.limits.maxCollectionItems) fail(path);
      enter(source, path, depth, state);
      try {
        const result: Record<string, unknown> = Object.create(null);
        for (const [key, item] of Object.entries(source)) {
          const itemPath = propertyPath(path, key);
          stringValue(key, itemPath, state);
          const property = schema.properties[key as keyof typeof schema.properties];
          if (property) result[key] = apply(property, item, itemPath, depth + 1, state);
          else if (schema.unknownProperties === 'reject') fail(itemPath);
          else if (schema.unknownProperties === 'preserve') {
            result[key] = cloneAny(item, itemPath, depth + 1, state);
          }
        }
        for (const [key, property] of Object.entries(schema.properties)) {
          if (!Object.hasOwn(source, key) && schemaDefault(property) !== undefined) {
            result[key] = apply(property, undefined, `${path}.${key}`, depth + 1, state);
          }
        }
        for (const required of schema.required) {
          if (!Object.hasOwn(result, required)) fail(`${path}.${required}`);
        }
        return frozenRecord(result);
      } finally {
        state.active.delete(source);
      }
    }
    case 'record': {
      const source = record(value, path);
      if (Object.keys(source).length > state.limits.maxCollectionItems) fail(path);
      enter(source, path, depth, state);
      try {
        const result: Record<string, unknown> = Object.create(null);
        for (const [key, item] of Object.entries(source)) {
          const itemPath = propertyPath(path, key);
          stringValue(key, itemPath, state);
          result[key] = apply(schema.values, item, itemPath, depth + 1, state);
        }
        return frozenRecord(result);
      } finally {
        state.active.delete(source);
      }
    }
    case 'union':
      for (const variant of schema.variants) {
        const branch: State = { active: state.active, limits: state.limits, nodes: state.nodes };
        try {
          const result = apply(variant, value, path, depth, branch);
          state.nodes = branch.nodes;
          return result;
        } catch (error) {
          state.nodes = branch.nodes;
          if (!(error instanceof ProtocolSchemaValueError)) throw error;
        }
      }
      fail(path);
  }
}

export function createProtocolSchemaValueParser(
  input: ProtocolSchema,
  options: ProtocolSchemaValueOptions = {},
): ProtocolSchemaValueParser {
  const schema = validateProtocolSchema(input);
  const limits = resolveProtocolSchemaValueLimits(options);
  return Object.freeze({
    parse(value: unknown): unknown {
      return apply(schema, value, '$', 1, { active: new WeakSet(), limits, nodes: 0 });
    },
  });
}

export function applyProtocolSchemaValue(
  schema: ProtocolSchema,
  value: unknown,
  options: ProtocolSchemaValueOptions = {},
): unknown {
  return createProtocolSchemaValueParser(schema, options).parse(value);
}
