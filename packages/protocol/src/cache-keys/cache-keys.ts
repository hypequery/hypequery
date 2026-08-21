import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { validateProtocolDeploymentReleaseTarget } from '../releases/validate.js';
import {
  PROTOCOL_CACHE_KEY_LIMITS,
  type DeriveProtocolCacheKeyOptions,
  type ProtocolCacheKeyErrorCode,
} from './types.js';

const SCHEME = 'hq1';
const NAMESPACE_DOMAIN = 'hypequery.cache.namespace.v1';
const ENTRY_DOMAIN = 'hypequery.cache.entry.v1';

const textEncoder = new TextEncoder();

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export class ProtocolCacheKeyError extends Error {
  readonly code: ProtocolCacheKeyErrorCode;

  constructor(code: ProtocolCacheKeyErrorCode) {
    // The message is the code and nothing else: an error here has the secret
    // and the preimage in scope, and neither may reach a log.
    super(code);
    this.name = 'ProtocolCacheKeyError';
    this.code = code;
  }
}

function cacheKeyError(code: ProtocolCacheKeyErrorCode): never {
  throw new ProtocolCacheKeyError(code);
}

/** RFC 4648 base64url without padding. */
function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index] as number;
    const b1 = bytes[index + 1];
    const b2 = bytes[index + 2];
    out += BASE64URL[b0 >> 2];
    out += BASE64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += BASE64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += BASE64URL[b2 & 0x3f];
  }
  return out;
}

/**
 * Joins parts with a single 0x00 byte. RFC 0008 restricts deployment target
 * tokens to an ASCII grammar that excludes 0x00, so the concatenation is
 * injective — which is why the namespace must be validated before this runs.
 */
function joinNulSeparated(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0) + parts.length - 1;
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part, index) => {
    if (index > 0) {
      out[offset] = 0x00;
      offset += 1;
    }
    out.set(part, offset);
    offset += part.byteLength;
  });
  return out;
}

function requireSecret(secret: Uint8Array | undefined): Uint8Array {
  if (!secret || secret.byteLength === 0) cacheKeyError('HQ_CACHE_KEY_SECRET_MISSING');
  if (secret.byteLength < PROTOCOL_CACHE_KEY_LIMITS.minSecretBytes) {
    cacheKeyError('HQ_CACHE_KEY_SECRET_TOO_SHORT');
  }
  return secret;
}

function requireNamespace(namespace: unknown): {
  readonly project: Uint8Array;
  readonly environment: Uint8Array;
} {
  try {
    const target = validateProtocolDeploymentReleaseTarget(namespace);
    return {
      project: textEncoder.encode(target.project),
      environment: textEncoder.encode(target.environment),
    };
  } catch {
    // Deliberately does not forward release-target validation details: a
    // single code keeps callers from branching on namespace internals.
    cacheKeyError('HQ_CACHE_KEY_INVALID_NAMESPACE');
  }
}

function requireKeyVersion(keyVersion: unknown): number {
  if (
    typeof keyVersion !== 'number'
    || !Number.isSafeInteger(keyVersion)
    || keyVersion < PROTOCOL_CACHE_KEY_LIMITS.minKeyVersion
    || keyVersion > PROTOCOL_CACHE_KEY_LIMITS.maxKeyVersion
  ) {
    cacheKeyError('HQ_CACHE_KEY_INVALID_VERSION');
  }
  return keyVersion;
}

function requirePreimage(preimage: Uint8Array | string): Uint8Array {
  if (
    typeof preimage === 'string'
    && preimage.length > PROTOCOL_CACHE_KEY_LIMITS.maxPreimageBytes
  ) {
    cacheKeyError('HQ_CACHE_KEY_PREIMAGE_TOO_LARGE');
  }
  const bytes = typeof preimage === 'string' ? textEncoder.encode(preimage) : preimage;
  if (bytes.byteLength > PROTOCOL_CACHE_KEY_LIMITS.maxPreimageBytes) {
    cacheKeyError('HQ_CACHE_KEY_PREIMAGE_TOO_LARGE');
  }
  return bytes;
}

/**
 * Derives the opaque namespace prefix. Truncated to 16 bytes because it is a
 * grouping label for prefix operations, not an authentication tag.
 */
export function deriveProtocolCacheNamespaceToken(
  secret: Uint8Array,
  project: string,
  environment: string,
): string {
  const key = requireSecret(secret);
  const namespace = requireNamespace({ project, environment });
  const input = joinNulSeparated([
    textEncoder.encode(NAMESPACE_DOMAIN),
    namespace.project,
    namespace.environment,
  ]);
  const mac = hmac(sha256, key, input);
  return base64url(mac.slice(0, PROTOCOL_CACHE_KEY_LIMITS.namespaceTokenBytes));
}

/**
 * Derives the opaque store key for one canonical preimage (RFC 0013).
 *
 * The preimage never appears in the result. An unkeyed digest would be
 * offline-guessable — the schema is public and identifier value spaces are
 * small — so the derivation is an HMAC under a per-namespace secret.
 */
export function deriveProtocolCacheKey(options: DeriveProtocolCacheKeyOptions): string {
  const secret = requireSecret(options.secret);
  const { project, environment } = requireNamespace(options.namespace);
  const keyVersion = requireKeyVersion(options.keyVersion);
  const preimage = requirePreimage(options.preimage);

  const namespaceToken = base64url(
    hmac(
      sha256,
      secret,
      joinNulSeparated([textEncoder.encode(NAMESPACE_DOMAIN), project, environment]),
    ).slice(0, PROTOCOL_CACHE_KEY_LIMITS.namespaceTokenBytes),
  );

  // The namespace participates in the entry MAC directly, not only through the
  // prefix, so two namespaces cannot collide even in a store that ignores
  // prefixes.
  const entryMac = hmac(
    sha256,
    secret,
    joinNulSeparated([textEncoder.encode(ENTRY_DOMAIN), project, environment, preimage]),
  );

  const key = `${SCHEME}.${keyVersion}.${namespaceToken}.${base64url(entryMac)}`;
  /* c8 ignore next 3 -- unreachable with version-1 limits; a guard against a
     future format change silently exceeding what stores accept. */
  if (textEncoder.encode(key).byteLength > PROTOCOL_CACHE_KEY_LIMITS.maxStoreKeyBytes) {
    cacheKeyError('HQ_CACHE_KEY_INVALID_VERSION');
  }
  return key;
}
