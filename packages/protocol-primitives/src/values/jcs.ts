import { valueError } from './errors.js';

export function serializeJcs(value: unknown): string {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
    || typeof value === 'number'
  ) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) valueError('HQ_VALUE_INVALID_FORMAT');
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeJcs).join(',')}]`;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeJcs(object[key])}`)
      .join(',')}}`;
  }
  valueError('HQ_VALUE_INVALID_FORMAT');
}
