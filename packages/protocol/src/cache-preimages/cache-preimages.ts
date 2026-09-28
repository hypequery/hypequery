import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { validateProtocolSemanticQuery } from '../expressions/validate.js';
import { serializeJcs } from '../values/jcs.js';
import type {
  BuildProtocolCachePreimageOptions,
  ProtocolCachePreimageErrorCode,
} from './types.js';

const FINGERPRINT_DOMAIN = 'hypequery.tenant.fingerprint.v1';
const MIN_SECRET_BYTES = 32;
const DEFINITION_IDENTITY = /^[0-9a-f]{64}$/;

const textEncoder = new TextEncoder();

export class ProtocolCachePreimageError extends Error {
  readonly code: ProtocolCachePreimageErrorCode;

  constructor(code: ProtocolCachePreimageErrorCode) {
    // The code and nothing else: the secret, tenant identifiers, and filter
    // values are all in scope wherever this is raised.
    super(code);
    this.name = 'ProtocolCachePreimageError';
    this.code = code;
  }
}

function fail(code: ProtocolCachePreimageErrorCode): never {
  throw new ProtocolCachePreimageError(code);
}

function requireSecret(secret: Uint8Array | undefined): Uint8Array {
  if (!secret || secret.byteLength === 0) fail('HQ_CACHE_PREIMAGE_SECRET_MISSING');
  if (secret.byteLength < MIN_SECRET_BYTES) fail('HQ_CACHE_PREIMAGE_SECRET_TOO_SHORT');
  return secret;
}

function fingerprint(secret: Uint8Array, tenantId: unknown): string {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    fail('HQ_CACHE_PREIMAGE_INVALID_TENANT');
  }
  const domain = textEncoder.encode(FINGERPRINT_DOMAIN);
  const id = textEncoder.encode(tenantId);
  const input = new Uint8Array(domain.byteLength + 1 + id.byteLength);
  input.set(domain, 0);
  input.set(id, domain.byteLength + 1);
  return bytesToHex(hmac(sha256, secret, input));
}

/**
 * The RFC 0009 tenant fingerprint: tells two tenants apart without revealing
 * either. Keyed by a namespace secret, because tenant identifier spaces are
 * small enough that an unkeyed digest could be reversed by enumeration.
 */
export function deriveProtocolTenantFingerprint(secret: Uint8Array, tenantId: string): string {
  return fingerprint(requireSecret(secret), tenantId);
}

/** Byte order of the UTF-8 encoding, which is what the RFC sorts by. */
function compareUtf8(left: string, right: string): number {
  const a = textEncoder.encode(left);
  const b = textEncoder.encode(right);
  const length = Math.min(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] as number) - (b[index] as number);
    if (difference !== 0) return difference;
  }
  return a.byteLength - b.byteLength;
}

function normalizeQuery(source: unknown): Record<string, unknown> {
  let query;
  try {
    query = validateProtocolSemanticQuery(source, { extension: 2 });
  } catch {
    // The expression code is not surfaced, so this family's set stays closed.
    fail('HQ_CACHE_PREIMAGE_INVALID_QUERY');
  }
  // AND-combined, so order cannot change rows; identical filters collapse.
  const filters = new Map<string, unknown>();
  for (const filter of query.filters ?? []) filters.set(serializeJcs(filter), filter);
  const normalized: Record<string, unknown> = {
    kind: query.kind,
    dataset: query.dataset,
    dimensions: query.dimensions ?? [],
    filters: [...filters.keys()].sort(compareUtf8).map((key) => filters.get(key)),
    segments: [...(query.segments ?? [])].sort(compareUtf8),
    orderBy: query.orderBy ?? [],
    by: query.by ?? null,
    offset: query.offset || null,
  };
  if (query.kind === 'metric') {
    normalized.metric = query.metric;
  } else {
    // Absent selects every measure and `[]` selects none, so they stay distinct.
    normalized.measures = query.measures ?? null;
  }
  return normalized;
}

function normalizeTenant(tenant: unknown, secret: Uint8Array): Record<string, unknown> {
  if (tenant === null || typeof tenant !== 'object' || Array.isArray(tenant)) {
    fail('HQ_CACHE_PREIMAGE_INVALID_TENANT');
  }
  const record = tenant as Record<string, unknown>;
  const fields = Object.keys(record).sort().join(',');
  if ((record.mode === 'none' || record.mode === 'all') && fields === 'mode') {
    return { mode: record.mode };
  }
  if (record.mode !== 'scoped' || fields !== 'ids,mode') fail('HQ_CACHE_PREIMAGE_INVALID_TENANT');
  const ids = record.ids;
  if (!Array.isArray(ids) || ids.length === 0) fail('HQ_CACHE_PREIMAGE_INVALID_TENANT');
  const fingerprints = new Set(ids.map((id: unknown) => fingerprint(secret, id)));
  return { mode: 'scoped', fingerprints: [...fingerprints].sort() };
}

function normalizeRowLimit(rowLimit: unknown): number | null {
  if (rowLimit === null) return null;
  if (typeof rowLimit !== 'number' || !Number.isSafeInteger(rowLimit) || rowLimit < 0) {
    fail('HQ_CACHE_PREIMAGE_INVALID_LIMIT');
  }
  return rowLimit;
}

/**
 * Builds the RFC 0009 cache preimage: the canonical bytes that identify a
 * cached semantic result. Feed them to `deriveProtocolCacheKey` (RFC 0013); never
 * log them, emit them, or use them as a key.
 *
 * Checks run in the RFC's normative order, so every implementation reports the
 * same first failure.
 */
export function buildProtocolCachePreimage(options: BuildProtocolCachePreimageOptions): string {
  const secret = requireSecret(options.secret);
  if (
    typeof options.definitionIdentity !== 'string'
    || !DEFINITION_IDENTITY.test(options.definitionIdentity)
  ) {
    fail('HQ_CACHE_PREIMAGE_INVALID_DEFINITION');
  }
  const query = normalizeQuery(options.query);
  const tenant = normalizeTenant(options.tenant, secret);
  const rowLimit = normalizeRowLimit(options.rowLimit);
  return serializeJcs({
    kind: 'hypequery-cache-preimage',
    version: 1,
    definition: options.definitionIdentity,
    query,
    tenant,
    rowLimit,
  });
}
