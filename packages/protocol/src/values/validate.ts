import { valueError } from './errors.js';
import { resolveLimits } from './limits.js';
import { snapshotPlainData } from './snapshot.js';
import type {
  CanonicalValue,
  CanonicalValueLimits,
  CanonicalValueOptions,
} from './types.js';

type JsonRecord = Record<string, unknown>;

interface ValidationState {
  readonly limits: Readonly<CanonicalValueLimits>;
  nodes: number;
}

const INTEGER_BITS = new Set([8, 16, 32, 64, 128, 256]);
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) valueError('HQ_VALUE_INVALID_FORMAT', path);
  return value;
}

function assertExactFields(
  value: JsonRecord,
  fields: readonly string[],
  path: string,
): void {
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) valueError('HQ_VALUE_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      valueError('HQ_VALUE_INVALID_FORMAT', `${path}.${field}`);
    }
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') valueError('HQ_VALUE_INVALID_FORMAT', path);
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') valueError('HQ_VALUE_INVALID_FORMAT', path);
  return value;
}

function requireMetadataInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
    valueError('HQ_VALUE_INVALID_FORMAT', path);
  }
  return value as number;
}

function validateUnicode(value: string, path: string, maxBytes: number): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      valueError('HQ_VALUE_CONTROL_CHARACTER', path);
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        valueError('HQ_VALUE_INVALID_UNICODE', path);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      valueError('HQ_VALUE_INVALID_UNICODE', path);
    }
  }
  if (textEncoder.encode(value).byteLength > maxBytes) {
    valueError('HQ_VALUE_TOO_LARGE', path);
  }
}

function validateCanonicalIntegerString(value: string, path: string): bigint {
  if (!/^(?:0|-[1-9]\d*|[1-9]\d*)$/.test(value)) {
    valueError('HQ_VALUE_INVALID_FORMAT', path);
  }
  return BigInt(value);
}

function validateIntegerTag(
  tag: JsonRecord,
  path: string,
  declaredClickHouseType?: string,
): void {
  assertExactFields(tag, ['bits', 'signed', 'type', 'value', 'version'], path);
  const bits = requireMetadataInteger(tag.bits, `${path}.bits`);
  if (!INTEGER_BITS.has(bits)) valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.bits`);
  const signed = requireBoolean(tag.signed, `${path}.signed`);
  const integer = validateCanonicalIntegerString(
    requireString(tag.value, `${path}.value`),
    `${path}.value`,
  );
  const width = BigInt(bits);
  const minimum = signed ? -(1n << (width - 1n)) : 0n;
  const maximum = signed ? (1n << (width - 1n)) - 1n : (1n << width) - 1n;
  if (integer < minimum || integer > maximum) {
    valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.value`);
  }
  const actualClickHouseType = `${signed ? '' : 'U'}Int${bits}`;
  if (declaredClickHouseType && declaredClickHouseType !== actualClickHouseType) {
    valueError('HQ_VALUE_TYPE_MISMATCH', path);
  }
}

function validateDecimalTag(tag: JsonRecord, path: string): void {
  assertExactFields(tag, ['coefficient', 'precision', 'scale', 'type', 'version'], path);
  const precision = requireMetadataInteger(tag.precision, `${path}.precision`);
  const scale = requireMetadataInteger(tag.scale, `${path}.scale`);
  if (precision < 1 || precision > 76 || scale < 0 || scale > precision) {
    valueError('HQ_VALUE_OUT_OF_RANGE', path);
  }
  const coefficient = requireString(tag.coefficient, `${path}.coefficient`);
  validateCanonicalIntegerString(coefficient, `${path}.coefficient`);
  if (coefficient.replace('-', '').length > precision) {
    valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.coefficient`);
  }
}

function parseDate(value: string, path: string): { year: number; month: number; day: number } {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) valueError('HQ_VALUE_INVALID_FORMAT', path);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    valueError('HQ_VALUE_INVALID_FORMAT', path);
  }
  return { year, month, day };
}

function validateDateTag(tag: JsonRecord, path: string): void {
  assertExactFields(tag, ['clickhouseType', 'type', 'value', 'version'], path);
  const clickhouseType = requireString(tag.clickhouseType, `${path}.clickhouseType`);
  if (clickhouseType !== 'Date' && clickhouseType !== 'Date32') {
    valueError('HQ_VALUE_TYPE_MISMATCH', `${path}.clickhouseType`);
  }
  const value = requireString(tag.value, `${path}.value`);
  parseDate(value, `${path}.value`);
  const minimum = clickhouseType === 'Date' ? '1970-01-01' : '1900-01-01';
  const maximum = clickhouseType === 'Date' ? '2149-06-06' : '2299-12-31';
  if (value < minimum || value > maximum) {
    valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.value`);
  }
}

function validateDatetimeTag(tag: JsonRecord, path: string): void {
  assertExactFields(
    tag,
    ['clickhouseType', 'precision', 'timezone', 'type', 'value', 'version'],
    path,
  );
  const clickhouseType = requireString(tag.clickhouseType, `${path}.clickhouseType`);
  if (clickhouseType !== 'DateTime' && clickhouseType !== 'DateTime64') {
    valueError('HQ_VALUE_TYPE_MISMATCH', `${path}.clickhouseType`);
  }
  const precision = requireMetadataInteger(tag.precision, `${path}.precision`);
  if (
    (clickhouseType === 'DateTime' && precision !== 0)
    || (clickhouseType === 'DateTime64' && (precision < 0 || precision > 9))
  ) {
    valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.precision`);
  }
  const timezone = requireString(tag.timezone, `${path}.timezone`);
  validateUnicode(timezone, `${path}.timezone`, 64);
  if (timezone !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(timezone)) {
    valueError('HQ_VALUE_INVALID_FORMAT', `${path}.timezone`);
  }

  const value = requireString(tag.value, `${path}.value`);
  const fraction = precision === 0 ? '' : `\\.(\\d{${precision}})`;
  const match = value.match(new RegExp(
    `^(\\d{4}-\\d{2}-\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})${fraction}Z$`,
  ));
  if (!match) valueError('HQ_VALUE_INVALID_FORMAT', `${path}.value`);
  parseDate(match[1], `${path}.value`);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) {
    valueError('HQ_VALUE_INVALID_FORMAT', `${path}.value`);
  }

  if (clickhouseType === 'DateTime') {
    if (value < '1970-01-01T00:00:00Z' || value > '2106-02-07T06:28:15Z') {
      valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.value`);
    }
    return;
  }

  const minimum = `1900-01-01T00:00:00${precision === 0 ? '' : `.${'0'.repeat(precision)}`}Z`;
  const maximum = precision === 9
    ? '2262-04-11T23:47:16.854775807Z'
    : `2299-12-31T23:59:59${precision === 0 ? '' : `.${'9'.repeat(precision)}`}Z`;
  if (value < minimum || value > maximum) {
    valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.value`);
  }
}

function validateUuidTag(tag: JsonRecord, path: string): void {
  assertExactFields(tag, ['type', 'value', 'version'], path);
  const value = requireString(tag.value, `${path}.value`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    valueError('HQ_VALUE_INVALID_FORMAT', `${path}.value`);
  }
}

function validateBytesTag(
  tag: JsonRecord,
  path: string,
  limits: Readonly<CanonicalValueLimits>,
): void {
  assertExactFields(tag, ['encoding', 'type', 'value', 'version'], path);
  if (tag.encoding !== 'base64url') {
    valueError('HQ_VALUE_INVALID_FORMAT', `${path}.encoding`);
  }
  const value = requireString(tag.value, `${path}.value`);
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    valueError('HQ_VALUE_INVALID_FORMAT', `${path}.value`);
  }
  const remainder = value.length % 4;
  if (remainder === 2 && (BASE64URL_ALPHABET.indexOf(value.at(-1) ?? '') & 0x0f) !== 0) {
    valueError('HQ_VALUE_INVALID_FORMAT', `${path}.value`);
  }
  if (remainder === 3 && (BASE64URL_ALPHABET.indexOf(value.at(-1) ?? '') & 0x03) !== 0) {
    valueError('HQ_VALUE_INVALID_FORMAT', `${path}.value`);
  }
  if (Math.floor(value.length * 6 / 8) > limits.maxDecodedBytes) {
    valueError('HQ_VALUE_TOO_LARGE', `${path}.value`);
  }
}

function validateEnumTag(
  tag: JsonRecord,
  path: string,
  limits: Readonly<CanonicalValueLimits>,
): void {
  assertExactFields(tag, ['bits', 'code', 'label', 'type', 'version'], path);
  const bits = requireMetadataInteger(tag.bits, `${path}.bits`);
  if (bits !== 8 && bits !== 16) valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.bits`);
  const code = requireMetadataInteger(tag.code, `${path}.code`);
  const minimum = -(2 ** (bits - 1));
  const maximum = 2 ** (bits - 1) - 1;
  if (code < minimum || code > maximum) valueError('HQ_VALUE_OUT_OF_RANGE', `${path}.code`);
  const label = requireString(tag.label, `${path}.label`);
  validateUnicode(label, `${path}.label`, limits.maxStringBytes);
}

function incrementLogicalNode(state: ValidationState, path: string): void {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) {
    valueError('HQ_VALUE_TOO_MANY_NODES', path);
  }
}

function validateCompositeDepth(depth: number, state: ValidationState, path: string): number {
  const next = depth + 1;
  if (next > state.limits.maxDepth) valueError('HQ_VALUE_TOO_DEEP', path);
  return next;
}

function validateValue(
  value: unknown,
  state: ValidationState,
  path: string,
  depth: number,
  declaredClickHouseType?: string,
): void {
  incrementLogicalNode(state, path);

  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    validateUnicode(value, path, state.limits.maxStringBytes);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) valueError('HQ_VALUE_NON_FINITE_FLOAT', path);
    if (Object.is(value, -0)) valueError('HQ_VALUE_NEGATIVE_ZERO', path);
    if (/^(?:U?Int)(?:8|16|32|64|128|256)$/.test(declaredClickHouseType ?? '')) {
      valueError('HQ_VALUE_INTEGER_TAG_REQUIRED', path);
    }
    return;
  }
  if (Array.isArray(value)) valueError('HQ_VALUE_RAW_COMPOSITE', path);

  const envelope = requireRecord(value, path);
  assertExactFields(envelope, ['$hypequery'], path);
  const tagPath = `${path}.$hypequery`;
  const tag = requireRecord(envelope.$hypequery, tagPath);
  const type = requireString(tag.type, `${tagPath}.type`);
  const version = requireMetadataInteger(tag.version, `${tagPath}.version`);
  if (version !== 1) valueError('HQ_VALUE_UNKNOWN_TAG_VERSION', `${tagPath}.version`);

  switch (type) {
    case 'integer': validateIntegerTag(tag, tagPath, declaredClickHouseType); return;
    case 'decimal': validateDecimalTag(tag, tagPath); return;
    case 'date': validateDateTag(tag, tagPath); return;
    case 'datetime': validateDatetimeTag(tag, tagPath); return;
    case 'uuid': validateUuidTag(tag, tagPath); return;
    case 'bytes': validateBytesTag(tag, tagPath, state.limits); return;
    case 'enum': validateEnumTag(tag, tagPath, state.limits); return;
    case 'array':
    case 'tuple': {
      assertExactFields(tag, ['type', 'values', 'version'], tagPath);
      if (!Array.isArray(tag.values)) valueError('HQ_VALUE_INVALID_FORMAT', `${tagPath}.values`);
      if (tag.values.length > state.limits.maxCollectionItems) {
        valueError('HQ_VALUE_TOO_MANY_ITEMS', `${tagPath}.values`);
      }
      const nextDepth = validateCompositeDepth(depth, state, path);
      tag.values.forEach((item, index) => {
        validateValue(item, state, `${tagPath}.values[${index}]`, nextDepth);
      });
      return;
    }
    case 'map': {
      assertExactFields(tag, ['entries', 'type', 'version'], tagPath);
      if (!Array.isArray(tag.entries)) valueError('HQ_VALUE_INVALID_FORMAT', `${tagPath}.entries`);
      if (tag.entries.length > state.limits.maxCollectionItems) {
        valueError('HQ_VALUE_TOO_MANY_ITEMS', `${tagPath}.entries`);
      }
      const nextDepth = validateCompositeDepth(depth, state, path);
      tag.entries.forEach((entry, index) => {
        const entryPath = `${tagPath}.entries[${index}]`;
        if (!Array.isArray(entry) || entry.length !== 2) {
          valueError('HQ_VALUE_INVALID_FORMAT', entryPath);
        }
        validateValue(entry[0], state, `${entryPath}[0]`, nextDepth);
        validateValue(entry[1], state, `${entryPath}[1]`, nextDepth);
      });
      return;
    }
    default: valueError('HQ_VALUE_UNKNOWN_TAG', `${tagPath}.type`);
  }
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

export function validateCanonicalValue(
  input: unknown,
  options: CanonicalValueOptions = {},
): CanonicalValue {
  const limits = resolveLimits(options);
  const snapshot = snapshotPlainData(input, limits);
  validateValue(snapshot, { limits, nodes: 0 }, '$', 0, options.declaredClickHouseType);
  deepFreeze(snapshot);
  return snapshot as CanonicalValue;
}
