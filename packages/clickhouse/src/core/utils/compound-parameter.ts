import { escapeValue } from '../utils.js';
import { parseParameterType, parseTupleField } from './parameter-type.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function invalidValue(type: string): never {
  throw new Error(`Cannot serialize parameter value as ${type}. Use a matching JavaScript value or pass ClickHouse text for the whole parameter.`);
}

/** Serialize one value in ClickHouse text format, following its declared type. */
function serializeValue(value: unknown, type: string): string {
  const { name, args } = parseParameterType(type);
  if ((name === 'Nullable' || name === 'LowCardinality') && args.length === 1) {
    if (name === 'Nullable' && value === null) return 'NULL';
    return serializeValue(value, args[0]!);
  }
  if (value === null || value === undefined) return invalidValue(type);
  // JSON is read as a quoted string inside compound text, unlike the tuple
  // and map syntax around it. Reuse the existing JSON escaping path.
  if (name === 'JSON') return escapeValue(value);
  if (name === 'Array' && args.length === 1) {
    if (!Array.isArray(value)) return invalidValue(type);
    return `[${Array.from(value, item => serializeValue(item, args[0]!)).join(',')}]`;
  }
  if (name === 'Tuple') {
    const fields = args.map(parseTupleField);
    let items: unknown[];
    if (Array.isArray(value) && value.length === fields.length) {
      items = value;
    } else if (isRecord(value) && fields.every(field => field.name !== undefined && Object.hasOwn(value, field.name))) {
      items = fields.map(field => value[field.name!]);
    } else {
      return invalidValue(type);
    }
    return `(${fields.map((field, i) => serializeValue(items[i], field.type)).join(',')})`;
  }
  if (name === 'Map' && args.length === 2) {
    const entries = value instanceof Map ? [...value.entries()] : isRecord(value) ? Object.entries(value) : undefined;
    if (!entries) return invalidValue(type);
    return `{${entries.map(([key, item]) => `${serializeValue(key, args[0]!)}:${serializeValue(item, args[1]!)}`).join(',')}}`;
  }
  if (typeof value === 'object' && !(value instanceof Date)) return invalidValue(type);
  // UInt64 values and object-map keys may be strings; text readers for numeric
  // types expect unquoted numbers. Validate before including them in the text.
  if (typeof value === 'string' && /^(?:U?Int\d+|Float\d+|Decimal\d*)$/.test(name)) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return invalidValue(type);
    return value;
  }
  return escapeValue(value);
}

/**
 * Keep compound values bound as strings for CAST. The adapter escapes the
 * resulting text again; tuple and map delimiters come only from the type.
 */
export function serializeCompoundParameter(value: unknown, type: string): unknown {
  if (Array.isArray(value) || value instanceof Map || isRecord(value)) {
    // A top-level JSON value is already handled by the adapter's normal
    // JSON.stringify + SQL escaping path. Quoting it here would double-wrap it.
    if (parseParameterType(type).name === 'JSON') return value;
    return serializeValue(value, type);
  }
  return value;
}
