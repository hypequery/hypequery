import { isProtocolIdentifier } from '../identifiers/index.js';
import { visibilityError } from './errors.js';
import type {
  ProtocolDatasetVisibility,
  ProtocolFieldVisibility,
  ProtocolVisibleFields,
} from './types.js';

export const PROTOCOL_FIELD_VISIBILITY_LIMITS = Object.freeze({
  maxDatasets: 256,
  maxFieldsPerList: 1_024,
});

type DataRecord = Record<string, unknown>;

function isRecord(value: unknown): value is DataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: DataRecord, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) visibilityError('HQ_VISIBILITY_INVALID', `${path}.${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) visibilityError('HQ_VISIBILITY_INVALID', `${path}.${key}`);
  }
}

function fields(value: unknown, path: string): ProtocolVisibleFields {
  if (value === '*') return '*';
  if (!Array.isArray(value)) visibilityError('HQ_VISIBILITY_INVALID', path);
  if (value.length > PROTOCOL_FIELD_VISIBILITY_LIMITS.maxFieldsPerList) {
    visibilityError('HQ_VISIBILITY_TOO_LARGE', path);
  }
  // Array.from visits holes as undefined, so a sparse list fails closed.
  const names = Array.from(value as unknown[], (name, index) => {
    if (typeof name !== 'string' || !isProtocolIdentifier(name)) {
      visibilityError('HQ_VISIBILITY_INVALID', `${path}[${index}]`);
    }
    return name;
  });
  if (new Set(names).size !== names.length) visibilityError('HQ_VISIBILITY_INVALID', path);
  return Object.freeze([...names].sort());
}

/**
 * Parses an untrusted visibility record. Unknown keys, malformed names and
 * oversized lists fail closed; the result is frozen with sorted field lists.
 */
export function validateProtocolFieldVisibility(input: unknown): ProtocolFieldVisibility {
  if (!isRecord(input)) visibilityError('HQ_VISIBILITY_INVALID');
  exactKeys(input, ['kind', 'version', 'datasets'], '$');
  if (input.kind !== 'hypequery-field-visibility') visibilityError('HQ_VISIBILITY_INVALID', '$.kind');
  if (input.version !== 1) visibilityError('HQ_VISIBILITY_INVALID', '$.version');
  if (!isRecord(input.datasets)) visibilityError('HQ_VISIBILITY_INVALID', '$.datasets');

  const entries = Object.entries(input.datasets);
  if (entries.length > PROTOCOL_FIELD_VISIBILITY_LIMITS.maxDatasets) {
    visibilityError('HQ_VISIBILITY_TOO_LARGE', '$.datasets');
  }
  const datasets: Record<string, ProtocolDatasetVisibility> = Object.create(null);
  for (const [name, entry] of entries.sort(([left], [right]) => (left < right ? -1 : 1))) {
    const path = `$.datasets.${name}`;
    if (!isProtocolIdentifier(name)) visibilityError('HQ_VISIBILITY_INVALID', path);
    if (!isRecord(entry)) visibilityError('HQ_VISIBILITY_INVALID', path);
    exactKeys(entry, ['dimensions', 'measures'], path);
    datasets[name] = Object.freeze({
      dimensions: fields(entry.dimensions, `${path}.dimensions`),
      measures: fields(entry.measures, `${path}.measures`),
    });
  }
  return Object.freeze({
    kind: 'hypequery-field-visibility',
    version: 1,
    datasets: Object.freeze(datasets),
  });
}
