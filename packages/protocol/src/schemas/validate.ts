import { ProtocolIdentifierError, parseProtocolIdentifier } from '../identifiers/index.js';
import {
  ProtocolValueError,
  encodeCanonicalValueToString,
  type CanonicalValue,
  validateCanonicalValue,
} from '../values/index.js';
import { schemaError } from './errors.js';
import { resolveSchemaLimits } from './limits.js';
import type {
  ProtocolSchema,
  ProtocolSchemaLimits,
  ProtocolSchemaOptions,
} from './types.js';

type DataRecord = Record<string, unknown>;

interface State {
  readonly limits: Readonly<ProtocolSchemaLimits>;
  readonly active: WeakSet<object>;
  nodes: number;
}

const textEncoder = new TextEncoder();
const ANNOTATIONS = ['description', 'default'] as const;

function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    schemaError('HQ_SCHEMA_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) schemaError('HQ_SCHEMA_UNSAFE_OBJECT', path);
  if (Object.getOwnPropertySymbols(input).length > 0) schemaError('HQ_SCHEMA_UNSAFE_OBJECT', path);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) schemaError('HQ_SCHEMA_UNSAFE_OBJECT', path);
  }
  return input as DataRecord;
}

function requireArray(input: unknown, path: string, state: State): readonly unknown[] {
  if (!Array.isArray(input)) schemaError('HQ_SCHEMA_TYPE', path);
  if (Object.getPrototypeOf(input) !== Array.prototype || Object.getOwnPropertySymbols(input).length > 0) {
    schemaError('HQ_SCHEMA_UNSAFE_OBJECT', path);
  }
  if (input.length > state.limits.maxCollectionItems) schemaError('HQ_SCHEMA_TOO_MANY_ITEMS', path);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      schemaError('HQ_SCHEMA_UNSAFE_OBJECT', `${path}[${index}]`);
    }
  }
  if (Object.keys(input).length !== input.length) schemaError('HQ_SCHEMA_UNSAFE_OBJECT', path);
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
    if (!allowed.has(key)) schemaError('HQ_SCHEMA_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) schemaError('HQ_SCHEMA_TYPE', `${path}.${key}`);
  }
}

function enter(value: object, depth: number, state: State, path: string): void {
  if (depth > state.limits.maxDepth) schemaError('HQ_SCHEMA_TOO_DEEP', path);
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) schemaError('HQ_SCHEMA_TOO_MANY_NODES', path);
  if (state.active.has(value)) schemaError('HQ_SCHEMA_UNSAFE_OBJECT', path);
  state.active.add(value);
}

function freezeRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function validateAnnotations(
  value: DataRecord,
  result: Record<string, unknown>,
  state: State,
  path: string,
  allowDefault = true,
): void {
  if (value.description !== undefined) {
    if (typeof value.description !== 'string') schemaError('HQ_SCHEMA_TYPE', `${path}.description`);
    canonicalValue(value.description, `${path}.description`);
    if (value.description.length > state.limits.maxDescriptionBytes) {
      schemaError('HQ_SCHEMA_TOO_LARGE', `${path}.description`);
    }
    if (textEncoder.encode(value.description).byteLength > state.limits.maxDescriptionBytes) {
      schemaError('HQ_SCHEMA_TOO_LARGE', `${path}.description`);
    }
    result.description = value.description;
  }
  if (value.default !== undefined) {
    if (!allowDefault) schemaError('HQ_SCHEMA_INVALID_VALUE', `${path}.default`);
    try {
      result.default = validateCanonicalValue(value.default);
    } catch (error) {
      if (error instanceof ProtocolValueError) schemaError('HQ_SCHEMA_INVALID_VALUE', `${path}.default`);
      throw error;
    }
  }
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', path);
  }
  return value as number;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
    schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', path);
  }
  return value;
}

function copyRange(
  value: DataRecord,
  result: Record<string, unknown>,
  minimumKey: string,
  maximumKey: string,
  path: string,
  integer: boolean,
): void {
  if (value[minimumKey] !== undefined) {
    const number = finiteNumber(value[minimumKey], `${path}.${minimumKey}`);
    if (integer && !Number.isSafeInteger(number)) schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', `${path}.${minimumKey}`);
    result[minimumKey] = number;
  }
  if (value[maximumKey] !== undefined) {
    const number = finiteNumber(value[maximumKey], `${path}.${maximumKey}`);
    if (integer && !Number.isSafeInteger(number)) schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', `${path}.${maximumKey}`);
    result[maximumKey] = number;
  }
}

function copyNonNegativeRange(
  value: DataRecord,
  result: Record<string, unknown>,
  minimumKey: string,
  maximumKey: string,
  path: string,
): void {
  if (value[minimumKey] !== undefined) {
    result[minimumKey] = nonNegativeInteger(value[minimumKey], `${path}.${minimumKey}`);
  }
  if (value[maximumKey] !== undefined) {
    result[maximumKey] = nonNegativeInteger(value[maximumKey], `${path}.${maximumKey}`);
  }
}

function assertOrderedBounds(result: Record<string, unknown>, path: string): void {
  const lower = result.exclusiveMinimum ?? result.minimum;
  const upper = result.exclusiveMaximum ?? result.maximum;
  const emptyAtEqual = lower === upper
    && (result.exclusiveMinimum !== undefined || result.exclusiveMaximum !== undefined);
  if (lower !== undefined && upper !== undefined
    && ((lower as number) > (upper as number) || emptyAtEqual)) {
    schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', path);
  }
  if (result.minimum !== undefined && result.exclusiveMinimum !== undefined) {
    schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', path);
  }
  if (result.maximum !== undefined && result.exclusiveMaximum !== undefined) {
    schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', path);
  }
}

function validateSchema(input: unknown, path: string, depth: number, state: State): ProtocolSchema {
  const value = requireRecord(input, path);
  enter(value, depth, state, path);
  try {
    if (typeof value.kind !== 'string') schemaError('HQ_SCHEMA_TYPE', `${path}.kind`);
    const kind = value.kind;
    const result: Record<string, unknown> = { kind };
    switch (kind) {
      case 'any':
      case 'null':
      case 'boolean':
        exactFields(value, ['kind'], ANNOTATIONS, path);
        validateAnnotations(value, result, state, path);
        break;
      case 'void':
        exactFields(value, ['kind'], ['description'], path);
        validateAnnotations(value, result, state, path, false);
        break;
      case 'string': {
        exactFields(value, ['kind'], [...ANNOTATIONS, 'minLength', 'maxLength'], path);
        validateAnnotations(value, result, state, path);
        copyNonNegativeRange(value, result, 'minLength', 'maxLength', path);
        if (result.minLength !== undefined && result.maxLength !== undefined
          && (result.minLength as number) > (result.maxLength as number)) {
          schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', path);
        }
        break;
      }
      case 'number':
      case 'integer':
        exactFields(value, ['kind'], [
          ...ANNOTATIONS, 'minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum',
        ], path);
        validateAnnotations(value, result, state, path);
        copyRange(value, result, 'minimum', 'maximum', path, kind === 'integer');
        copyRange(value, result, 'exclusiveMinimum', 'exclusiveMaximum', path, kind === 'integer');
        assertOrderedBounds(result, path);
        break;
      case 'literal':
        exactFields(value, ['kind', 'value'], ANNOTATIONS, path);
        validateAnnotations(value, result, state, path);
        result.value = canonicalValue(value.value, `${path}.value`);
        break;
      case 'enum':
        exactFields(value, ['kind', 'values'], ANNOTATIONS, path);
        validateAnnotations(value, result, state, path);
        result.values = validateEnum(value.values, `${path}.values`, state);
        break;
      case 'array': {
        exactFields(value, ['kind', 'items'], [...ANNOTATIONS, 'minItems', 'maxItems'], path);
        validateAnnotations(value, result, state, path);
        result.items = validateSchema(value.items, `${path}.items`, depth + 1, state);
        copyNonNegativeRange(value, result, 'minItems', 'maxItems', path);
        if (result.minItems !== undefined && result.maxItems !== undefined
          && (result.minItems as number) > (result.maxItems as number)) {
          schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', path);
        }
        break;
      }
      case 'object':
        validateObject(value, result, path, depth, state);
        break;
      case 'record':
        exactFields(value, ['kind', 'values'], ANNOTATIONS, path);
        validateAnnotations(value, result, state, path);
        result.values = validateSchema(value.values, `${path}.values`, depth + 1, state);
        break;
      case 'union': {
        exactFields(value, ['kind', 'variants'], ANNOTATIONS, path);
        validateAnnotations(value, result, state, path);
        const variants = requireArray(value.variants, `${path}.variants`, state);
        if (variants.length < 2) schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', `${path}.variants`);
        result.variants = Object.freeze(variants.map((variant, index) =>
          validateSchema(variant, `${path}.variants[${index}]`, depth + 1, state)));
        break;
      }
      default:
        schemaError('HQ_SCHEMA_UNKNOWN_KIND', `${path}.kind`);
    }
    validateDefault(result, path);
    return freezeRecord(result) as unknown as ProtocolSchema;
  } finally {
    state.active.delete(value);
  }
}

function canonicalValue(input: unknown, path: string) {
  try {
    return validateCanonicalValue(input);
  } catch (error) {
    if (error instanceof ProtocolValueError) schemaError('HQ_SCHEMA_INVALID_VALUE', path);
    throw error;
  }
}

function validateEnum(input: unknown, path: string, state: State): readonly unknown[] {
  const values = requireArray(input, path, state);
  if (values.length === 0) schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', path);
  const validated = values.map((value, index) => canonicalValue(value, `${path}[${index}]`));
  const encoded = validated.map(value => encodeCanonicalValueToString(value));
  if (new Set(encoded).size !== encoded.length) schemaError('HQ_SCHEMA_DUPLICATE_VALUE', path);
  return Object.freeze(validated);
}

function validateObject(
  value: DataRecord,
  result: Record<string, unknown>,
  path: string,
  depth: number,
  state: State,
): void {
  exactFields(value, ['kind', 'properties', 'required', 'unknownProperties'], ANNOTATIONS, path);
  validateAnnotations(value, result, state, path);
  const properties = requireRecord(value.properties, `${path}.properties`);
  if (state.active.has(properties)) schemaError('HQ_SCHEMA_UNSAFE_OBJECT', `${path}.properties`);
  state.active.add(properties);
  const propertyEntries = Object.entries(properties);
  if (propertyEntries.length > state.limits.maxCollectionItems) {
    schemaError('HQ_SCHEMA_TOO_MANY_ITEMS', `${path}.properties`);
  }
  const snapshot: Record<string, unknown> = Object.create(null);
  try {
    for (const [name, schema] of propertyEntries) {
      try {
        parseProtocolIdentifier(name);
      } catch (error) {
        if (error instanceof ProtocolIdentifierError) schemaError('HQ_SCHEMA_INVALID_IDENTIFIER', `${path}.properties`);
        throw error;
      }
      snapshot[name] = validateSchema(schema, `${path}.properties.${name}`, depth + 1, state);
    }
  } finally {
    state.active.delete(properties);
  }
  result.properties = Object.freeze(snapshot);
  const required = requireArray(value.required, `${path}.required`, state);
  const requiredNames = required.map((name, index) => {
    if (typeof name !== 'string' || !Object.hasOwn(snapshot, name)) {
      schemaError('HQ_SCHEMA_INVALID_REQUIRED', `${path}.required[${index}]`);
    }
    return name;
  });
  if (new Set(requiredNames).size !== requiredNames.length) {
    schemaError('HQ_SCHEMA_INVALID_REQUIRED', `${path}.required`);
  }
  result.required = Object.freeze(requiredNames);
  if (value.unknownProperties !== 'reject' && value.unknownProperties !== 'strip'
    && value.unknownProperties !== 'preserve') {
    schemaError('HQ_SCHEMA_INVALID_CONSTRAINT', `${path}.unknownProperties`);
  }
  result.unknownProperties = value.unknownProperties;
}

function validateDefault(schema: Record<string, unknown>, path: string): void {
  if (schema.default === undefined) return;
  if (!matchesSchema(schema as unknown as ProtocolSchema, schema.default as CanonicalValue)) {
    schemaError('HQ_SCHEMA_INVALID_VALUE', `${path}.default`);
  }
}

function matchesSchema(schema: ProtocolSchema, value: CanonicalValue): boolean {
  switch (schema.kind) {
    case 'any':
      return true;
    case 'void':
      return false;
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string': {
      if (typeof value !== 'string') return false;
      const length = [...value].length;
      return (schema.minLength === undefined || length >= schema.minLength)
        && (schema.maxLength === undefined || length <= schema.maxLength);
    }
    case 'number':
    case 'integer':
      return matchesNumber(schema, value);
    case 'literal':
      return encodeCanonicalValueToString(value) === encodeCanonicalValueToString(schema.value);
    case 'enum': {
      const encoded = encodeCanonicalValueToString(value);
      return schema.values.some(item => encodeCanonicalValueToString(item) === encoded);
    }
    case 'array': {
      const values = taggedValues(value, 'array');
      return values !== undefined
        && (schema.minItems === undefined || values.length >= schema.minItems)
        && (schema.maxItems === undefined || values.length <= schema.maxItems)
        && values.every(item => matchesSchema(schema.items, item));
    }
    case 'object': {
      const entries = taggedEntries(value);
      if (!entries) return false;
      const found = new Set<string>();
      for (const [key, item] of entries) {
        if (typeof key !== 'string') return false;
        const property = schema.properties[key as keyof typeof schema.properties];
        if (property) {
          if (!matchesSchema(property, item)) return false;
          found.add(key);
        } else if (schema.unknownProperties === 'reject') {
          return false;
        }
      }
      return schema.required.every(name => found.has(name));
    }
    case 'record': {
      const entries = taggedEntries(value);
      return entries !== undefined
        && entries.every(([key, item]) => typeof key === 'string' && matchesSchema(schema.values, item));
    }
    case 'union':
      return schema.variants.some(variant => matchesSchema(variant, value));
  }
}

function matchesNumber(
  schema: Extract<ProtocolSchema, { kind: 'number' | 'integer' }>,
  value: CanonicalValue,
): boolean {
  if (typeof value !== 'number' || (schema.kind === 'integer' && !Number.isSafeInteger(value))) {
    return false;
  }
  return (schema.minimum === undefined || value >= schema.minimum)
    && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum)
    && (schema.maximum === undefined || value <= schema.maximum)
    && (schema.exclusiveMaximum === undefined || value < schema.exclusiveMaximum);
}

function taggedValues(value: CanonicalValue, type: 'array'): readonly CanonicalValue[] | undefined {
  if (typeof value !== 'object' || value === null || !('$hypequery' in value)) return undefined;
  const tag = value.$hypequery;
  return tag.type === type ? tag.values : undefined;
}

function taggedEntries(
  value: CanonicalValue,
): readonly (readonly [CanonicalValue, CanonicalValue])[] | undefined {
  if (typeof value !== 'object' || value === null || !('$hypequery' in value)) return undefined;
  const tag = value.$hypequery;
  return tag.type === 'map' ? tag.entries : undefined;
}

export function validateProtocolSchema(
  input: unknown,
  options: ProtocolSchemaOptions = {},
): ProtocolSchema {
  return validateSchema(input, '$', 1, {
    limits: resolveSchemaLimits(options),
    active: new WeakSet(),
    nodes: 0,
  });
}
