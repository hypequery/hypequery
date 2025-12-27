import { stableStringify } from './serialization.js';

interface CacheKeyInput {
  namespace: string;
  sql: string;
  parameters: unknown[];
  settings?: Record<string, unknown> | undefined;
  version?: string;
  tableName?: string;
}

const FNV_OFFSET = BigInt('0xcbf29ce484222325');
const FNV_PRIME = BigInt('0x100000001b3');
const FNV_MOD = BigInt('0x10000000000000000');

function fnv1a64(value: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * FNV_PRIME) % FNV_MOD;
  }
  return hash.toString(16);
}

function formatSegment(segment?: string): string {
  if (!segment) return 'query';
  const sanitized = segment.replace(/[^a-zA-Z0-9_-]/g, '-');
  return sanitized.slice(0, 48) || 'query';
}

export function computeCacheKey({
  namespace,
  sql,
  parameters,
  settings,
  version = 'v1',
  tableName
}: CacheKeyInput): string {
  const serializedParams = stableStringify(parameters);
  const serializedSettings = stableStringify(settings || null);
  const material = `${sql}\n${serializedParams}\n${serializedSettings}`;
  const digest = fnv1a64(material);
  const tableSegment = formatSegment(tableName);
  return `hq:${version}:${namespace}:${tableSegment}:${digest}`;
}
