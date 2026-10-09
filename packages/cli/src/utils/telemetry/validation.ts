import { COMMON_PROPERTIES, EVENT_CATALOG, type TelemetryEvent, type TelemetryEventName } from './catalog.js';
import { COMMAND_FLAGS, GLOBAL_FLAGS, type TelemetryCommand } from './domains.js';
import type { Field, Fields } from './schema.js';
import { matchesTelemetryFormat } from './value-formats.js';

/** Only plain JSON data; reject accessors, custom prototypes and symbol keys. */
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
}

function validField(field: Field, value: unknown): boolean {
  switch (field.kind) {
    case 'boolean': return typeof value === 'boolean';
    case 'enum': return field.values.includes(value as never);
    case 'enum_list': return Array.isArray(value)
      && value.length <= field.values.length
      && Object.getPrototypeOf(value) === Array.prototype
      && Reflect.ownKeys(value).length === value.length + 1
      && Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
        .every(descriptor => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value'))
      && new Set(value).size === value.length
      && value.every(item => typeof item === 'string' && field.values.includes(item));
    case 'format': return matchesTelemetryFormat(field.format, value);
    case 'record': return validProperties(field.fields, value);
  }
}

function validProperties(fields: Fields, value: unknown): value is Record<string, unknown> {
  return plainRecord(value)
    && Object.keys(value).every(key => Object.hasOwn(fields, key) && validField(fields[key], value[key]))
    && Object.entries(fields).every(([key, field]) => field.optional || Object.hasOwn(value, key));
}

/** Reject the entire payload on unknown content; never guess how to redact it. */
export function validateTelemetryEvent(input: unknown): input is TelemetryEvent {
  try {
    if (!plainRecord(input) || Object.keys(input).length !== 2
      || !Object.hasOwn(input, 'event') || !Object.hasOwn(input, 'properties')
      || typeof input.event !== 'string' || !Object.hasOwn(EVENT_CATALOG, input.event)
      || !plainRecord(input.properties)) return false;
    const definition = EVENT_CATALOG[input.event as TelemetryEventName];
    let variant: Fields = {};
    if ('variants' in definition) {
      const command = input.properties.command;
      if (typeof command !== 'string' || !Object.hasOwn(definition.variants, command)) return false;
      variant = (definition.variants as Record<string, Fields>)[command];
    }
    if (!validProperties({ ...COMMON_PROPERTIES, ...definition.properties, ...variant }, input.properties)) return false;
    if (input.event === 'cli_command_completed') {
      const command = input.properties.command as TelemetryCommand;
      const allowed: readonly string[] = [...COMMAND_FLAGS[command], ...GLOBAL_FLAGS];
      if (!(input.properties.flags_used as string[]).every(flag => allowed.includes(flag))) return false;
    }
    return true;
  } catch {
    // Proxies and malformed untrusted objects must not affect the command.
    return false;
  }
}

type DeepExact<A, E> = E extends unknown ? A extends E
  ? A extends readonly unknown[] ? A : A extends object
    ? { [K in keyof A]: K extends keyof E ? DeepExact<A[K], E[K]> : never }
    : A
  : never : never;

/** The typed construction boundary also checks runtime data and returns a detached JSON snapshot. */
export function createTelemetryEvent<const T extends TelemetryEvent>(
  input: T & DeepExact<T, TelemetryEvent>,
): TelemetryEvent | null {
  if (!validateTelemetryEvent(input)) return null;
  try {
    const snapshot: unknown = JSON.parse(JSON.stringify(input));
    return validateTelemetryEvent(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}
