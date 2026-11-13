import { businessContextError } from './errors.js';
import { resolveBusinessContextLimits } from './limits.js';
import type {
  ProtocolBusinessContext,
  ProtocolBusinessContextGlossaryTerm,
  ProtocolBusinessContextKpi,
  ProtocolBusinessContextLimits,
  ProtocolBusinessContextOptions,
} from './types.js';

type DataRecord = Record<string, unknown>;

const TEXT_FIELDS = [
  'summary',
  'industry',
  'businessModel',
  'customers',
  'audience',
  'conventions',
] as const;
const TEXT_LIST_FIELDS = ['goals', 'caveats'] as const;
const FIELD_ORDER = [
  'summary',
  'industry',
  'businessModel',
  'customers',
  'audience',
  'goals',
  'kpis',
  'glossary',
  'conventions',
  'caveats',
] as const;
const ALLOWED_FIELDS = new Set<string>(['kind', 'version', ...FIELD_ORDER]);
/** C0/C1 controls other than tab and newline, which have no meaning in prose. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    businessContextError('HQ_BUSINESS_CONTEXT_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    businessContextError('HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT', path);
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    businessContextError('HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT', path);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      businessContextError('HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT', path);
    }
  }
  return input as DataRecord;
}

function requireArray(input: unknown, path: string, maxItems: number): readonly unknown[] {
  if (!Array.isArray(input)) businessContextError('HQ_BUSINESS_CONTEXT_TYPE', path);
  if (Object.getPrototypeOf(input) !== Array.prototype
    || Object.getOwnPropertySymbols(input).length > 0) {
    businessContextError('HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT', path);
  }
  if (input.length > maxItems) businessContextError('HQ_BUSINESS_CONTEXT_TOO_MANY_ITEMS', path);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      businessContextError('HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT', `${path}[${index}]`);
    }
  }
  if (Object.keys(input).length !== input.length
    || Object.getOwnPropertyNames(input).length !== input.length + 1) {
    businessContextError('HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT', path);
  }
  return input;
}

function exactFields(value: DataRecord, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) businessContextError('HQ_BUSINESS_CONTEXT_UNKNOWN_FIELD', `${path}.${key}`);
  }
}

/** Trimmed, non-empty prose without control characters or broken UTF-16. */
function text(
  value: unknown,
  path: string,
  limits: Readonly<ProtocolBusinessContextLimits>,
): string {
  if (typeof value !== 'string') businessContextError('HQ_BUSINESS_CONTEXT_TYPE', path);
  const trimmed = value.trim();
  if (trimmed.length === 0 || CONTROL_CHARACTER.test(trimmed) || LONE_SURROGATE.test(trimmed)) {
    businessContextError('HQ_BUSINESS_CONTEXT_INVALID_VALUE', path);
  }
  if (trimmed.length > limits.maxTextLength) {
    businessContextError('HQ_BUSINESS_CONTEXT_TOO_LARGE', path);
  }
  return trimmed;
}

/** Case- and whitespace-insensitive key used to reject ambiguous duplicate terms. */
function termKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

function textList(
  value: unknown,
  path: string,
  limits: Readonly<ProtocolBusinessContextLimits>,
): readonly string[] {
  const items = requireArray(value, path, limits.maxItems);
  return Object.freeze(items.map((item, index) => text(item, `${path}[${index}]`, limits)));
}

function pairs<K extends string, V extends string>(
  value: unknown,
  path: string,
  keyField: K,
  valueField: V,
  limits: Readonly<ProtocolBusinessContextLimits>,
): readonly Readonly<Record<K | V, string>>[] {
  const items = requireArray(value, path, limits.maxItems);
  const allowed = new Set<string>([keyField, valueField]);
  const seen = new Set<string>();
  return Object.freeze(items.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = requireRecord(item, itemPath);
    exactFields(record, allowed, itemPath);
    if (!Object.hasOwn(record, keyField)) businessContextError('HQ_BUSINESS_CONTEXT_TYPE', `${itemPath}.${keyField}`);
    if (!Object.hasOwn(record, valueField)) businessContextError('HQ_BUSINESS_CONTEXT_TYPE', `${itemPath}.${valueField}`);
    const key = text(record[keyField], `${itemPath}.${keyField}`, limits);
    const normalized = termKey(key);
    if (seen.has(normalized)) {
      businessContextError('HQ_BUSINESS_CONTEXT_DUPLICATE', `${itemPath}.${keyField}`);
    }
    seen.add(normalized);
    return Object.freeze({
      [keyField]: key,
      [valueField]: text(record[valueField], `${itemPath}.${valueField}`, limits),
    } as Record<K | V, string>);
  }));
}

/**
 * Validates and canonicalises a business context document.
 *
 * Canonical form trims text, omits empty lists and keeps author order. Two
 * inputs that differ only in those respects therefore share one identity.
 */
export function validateProtocolBusinessContext(
  input: unknown,
  options: ProtocolBusinessContextOptions = {},
): ProtocolBusinessContext {
  const limits = resolveBusinessContextLimits(options);
  const value = requireRecord(input, '$');
  exactFields(value, ALLOWED_FIELDS, '$');
  if (value.kind !== 'hypequery-business-context') {
    businessContextError('HQ_BUSINESS_CONTEXT_TYPE', '$.kind');
  }
  if (value.version !== 1) businessContextError('HQ_BUSINESS_CONTEXT_INVALID_VERSION', '$.version');

  const fields: Record<string, unknown> = {};
  for (const key of TEXT_FIELDS) {
    if (value[key] !== undefined) fields[key] = text(value[key], `$.${key}`, limits);
  }
  for (const key of TEXT_LIST_FIELDS) {
    if (value[key] === undefined) continue;
    const list = textList(value[key], `$.${key}`, limits);
    if (list.length > 0) fields[key] = list;
  }
  if (value.kpis !== undefined) {
    const kpis: readonly ProtocolBusinessContextKpi[] = pairs(
      value.kpis, '$.kpis', 'name', 'definition', limits,
    );
    if (kpis.length > 0) fields.kpis = kpis;
  }
  if (value.glossary !== undefined) {
    const glossary: readonly ProtocolBusinessContextGlossaryTerm[] = pairs(
      value.glossary, '$.glossary', 'term', 'meaning', limits,
    );
    if (glossary.length > 0) fields.glossary = glossary;
  }

  const ordered: Record<string, unknown> = { kind: 'hypequery-business-context', version: 1 };
  for (const key of FIELD_ORDER) {
    if (fields[key] !== undefined) ordered[key] = fields[key];
  }
  return Object.freeze(ordered) as unknown as ProtocolBusinessContext;
}

/** True when the document carries no authored content beyond its header. */
export function isEmptyProtocolBusinessContext(context: ProtocolBusinessContext): boolean {
  return FIELD_ORDER.every(key => context[key] === undefined);
}
