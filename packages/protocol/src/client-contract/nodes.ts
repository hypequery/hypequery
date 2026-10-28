import type { ClientDimension, ClientEndpointAnnotations, ClientFieldAnnotation, ClientFilter, ClientMeasure,
  ClientQueryLimits, ClientTime } from './types.js';
import { clientError } from './errors.js';
import { bool, choice, CLIENT_FIELD_TYPES, CLIENT_GRAINS, CLIENT_OPERATORS,
  integer, name, names, optionalShape, pointer, record, shape, text, timezone } from './primitives.js';

export function dimension(input: unknown, path: string): ClientDimension {
  const value = shape(input, ['type', 'wireType', 'nullable', 'groupable', 'orderable'], path);
  const type = choice(value.type, CLIENT_FIELD_TYPES, pointer(path, 'type'));
  const wires = type === 'number' ? ['number', 'string', 'number-or-string'] as const
    : type === 'boolean' ? ['boolean'] as const : ['string'] as const;
  const wireType = choice(value.wireType, wires, pointer(path, 'wireType'));
  if (typeof value.nullable !== 'boolean' && value.nullable !== 'unknown') {
    clientError('HQ_CLIENT_SHAPE', pointer(path, 'nullable'));
  }
  return { type, wireType, nullable: value.nullable,
    groupable: bool(value.groupable, pointer(path, 'groupable')),
    orderable: bool(value.orderable, pointer(path, 'orderable')) };
}
export function measure(input: unknown, path: string): ClientMeasure {
  const value = shape(input, ['wireType', 'nullable', 'having'], path);
  if (value.wireType !== 'string') clientError('HQ_CLIENT_SHAPE', pointer(path, 'wireType'));
  if (value.nullable !== true) clientError('HQ_CLIENT_SHAPE', pointer(path, 'nullable'));
  return { wireType: 'string', nullable: true, having: bool(value.having, pointer(path, 'having')) };
}
export function filter(input: unknown, path: string): ClientFilter {
  const value = shape(input, ['type', 'operators'], path);
  const type = choice(value.type, CLIENT_FIELD_TYPES, pointer(path, 'type'));
  const allowed = type === 'boolean' ? ['eq', 'neq', 'in', 'notIn']
    : type === 'number' ? CLIENT_OPERATORS.filter(item => item !== 'like') : CLIENT_OPERATORS;
  const operators = names(value.operators, pointer(path, 'operators'), allowed);
  if (operators.length === 0) clientError('HQ_CLIENT_SHAPE', pointer(path, 'operators'));
  return { type, operators: operators.sort() };
}
export function fields<T>(input: unknown, path: string, validate: (v: unknown, p: string) => T): Record<string, T> {
  const value = record(input, path);
  if (Object.keys(value).length > 256) clientError('HQ_CLIENT_LIMIT', path);
  const result: Record<string, T> = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    name(key, path, true);
    result[key] = validate(value[key], pointer(path, key));
  }
  return result;
}
export function time(input: unknown, path: string): ClientTime | null {
  if (input === null) return null;
  const value = shape(input, ['grains', 'defaultTimezone', 'timezone', 'periodFormat'], path);
  const grains = names(value.grains, pointer(path, 'grains'), CLIENT_GRAINS);
  if (grains.length === 0) clientError('HQ_CLIENT_SHAPE', pointer(path, 'grains'));
  const defaultTimezone = timezone(value.defaultTimezone, pointer(path, 'defaultTimezone'));
  const enabled = bool(value.timezone, pointer(path, 'timezone'));
  if (value.periodFormat !== 'calendar-date-or-local-datetime-v1') clientError('HQ_CLIENT_SHAPE', pointer(path, 'periodFormat'));
  return { grains: grains.sort(), defaultTimezone, timezone: enabled, periodFormat: value.periodFormat };
}
export function limits(input: unknown, path: string): ClientQueryLimits {
  const bounds = { defaultLimit: [1, 100000], maxLimit: [1, 100000], maxOffset: [0, 1000000],
    maxDimensions: [0, 100], maxMeasures: [0, 100], maxPredicates: [0, 100],
    maxOrderBy: [0, 100], maxFilterValues: [1, 10000] };
  const value = shape(input, Object.keys(bounds), path);
  const result: Record<string, number> = Object.create(null);
  for (const [key, [low, high]] of Object.entries(bounds)) {
    result[key] = integer(value[key], low, high, pointer(path, key));
  }
  return result as unknown as ClientQueryLimits;
}
function annotation(input: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  const value = optionalShape(input, keys, path);
  const result: Record<string, unknown> = Object.create(null);
  if (Object.hasOwn(value, 'label')) result.label = text(value.label, pointer(path, 'label'));
  if (Object.hasOwn(value, 'description')) result.description = text(value.description, pointer(path, 'description'));
  return result;
}
/** Presentation text; references to dimension/measure keys are checked with the endpoint's. */
export function annotations(input: unknown, path: string): ClientEndpointAnnotations {
  const result = annotation(input, path, ['label', 'description', 'fields']);
  const value = input as Record<string, unknown>;
  if (Object.hasOwn(value, 'fields')) {
    const fieldsPath = pointer(path, 'fields');
    const entries = record(value.fields, fieldsPath);
    const keys = Object.keys(entries);
    if (keys.length > 512) clientError('HQ_CLIENT_LIMIT', fieldsPath);
    if (keys.length === 0) clientError('HQ_CLIENT_SHAPE', fieldsPath);
    const described: Record<string, ClientFieldAnnotation> = Object.create(null);
    for (const key of keys.sort()) {
      name(key, fieldsPath, true);
      described[key] = annotation(entries[key], pointer(fieldsPath, key), ['label', 'description']);
    }
    result.fields = described;
  }
  return result;
}
