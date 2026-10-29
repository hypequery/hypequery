import { CLIENT_TIMEZONE_NAMES } from './timezone-names.js';
import { parseProtocolIdentifier } from '../identifiers/identifiers.js';
import { clientError } from './errors.js';
export type ClientRecord = Record<string, unknown>;
export const CLIENT_FIELD_TYPES = ['string', 'number', 'boolean', 'timestamp'] as const;
export const CLIENT_GRAINS = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'] as const;
export const CLIENT_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like', 'isNull', 'isNotNull'];
export function pointer(path: string, key: string | number): string {
  return path + '/' + String(key).replaceAll('~', '~0').replaceAll('/', '~1');
}
export function record(input: unknown, path: string): ClientRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) clientError('HQ_CLIENT_SHAPE', path);
  return input as ClientRecord;
}
/** The error keeps the shared fixtures' parent path and names the first unlisted member as `field`. */
function rejectUnknownField(value: ClientRecord, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find(key => !keys.includes(key));
  if (unknown !== undefined) clientError('HQ_CLIENT_UNKNOWN_FIELD', path, unknown);
}
/** Closed object whose listed members are all optional; at least one is required. */
export function optionalShape(input: unknown, keys: readonly string[], path: string): ClientRecord {
  const value = record(input, path);
  rejectUnknownField(value, keys, path);
  if (!keys.some(key => Object.hasOwn(value, key))) clientError('HQ_CLIENT_SHAPE', path);
  return value;
}
export function shape(input: unknown, keys: readonly string[], path: string): ClientRecord {
  const value = record(input, path);
  rejectUnknownField(value, keys, path);
  if (keys.some(key => !Object.hasOwn(value, key))) clientError('HQ_CLIENT_SHAPE', path);
  return value;
}
export function choice<T extends string>(input: unknown, choices: readonly T[], path: string): T {
  if (typeof input !== 'string' || !choices.includes(input as T)) clientError('HQ_CLIENT_SHAPE', path);
  return input as T;
}
export function bool(input: unknown, path: string): boolean {
  if (typeof input !== 'boolean') clientError('HQ_CLIENT_SHAPE', path);
  return input;
}
export function integer(input: unknown, low: number, high: number, path: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < low || (input as number) > high) {
    clientError('HQ_CLIENT_SHAPE', path);
  }
  return input as number;
}
export function name(input: unknown, path: string, qualified = false): string {
  if (typeof input !== 'string') clientError('HQ_CLIENT_IDENTIFIER', path);
  const parts = input.split('.');
  if (parts.length > (qualified ? 2 : 1)) clientError('HQ_CLIENT_IDENTIFIER', path);
  try { for (const part of parts) parseProtocolIdentifier(part); }
  catch { clientError('HQ_CLIENT_IDENTIFIER', path); }
  return input;
}
export function names(input: unknown, path: string, allowed?: readonly string[]): string[] {
  if (!Array.isArray(input)) clientError('HQ_CLIENT_SHAPE', path);
  const result = input.map((item, index) => allowed
    ? choice(item, allowed, pointer(path, index))
    : name(item, pointer(path, index), true));
  if (new Set(result).size !== result.length) clientError('HQ_CLIENT_DUPLICATE', path);
  return result;
}
export function route(input: unknown, path: string): string {
  if (typeof input !== 'string' || !/^\/(?:[A-Za-z0-9_~.-]+\/)*[A-Za-z0-9_~.-]+$/.test(input)
    || input.split('/').some(part => part === '.' || part === '..')) clientError('HQ_CLIENT_PATH', path);
  return input;
}
const textEncoder = new TextEncoder();
/** Deployment label/description rules: non-blank, control-free, at most 4096 UTF-8 bytes. */
export function text(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > 4096) clientError('HQ_CLIENT_SHAPE', path);
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) clientError('HQ_CLIENT_SHAPE', path);
  }
  if (textEncoder.encode(input).byteLength > 4096) clientError('HQ_CLIENT_SHAPE', path);
  return input;
}
export function timezone(input: unknown, path: string): string {
  if (typeof input !== 'string' || !CLIENT_TIMEZONE_NAMES.has(input)) clientError('HQ_CLIENT_SHAPE', path);
  return input;
}
