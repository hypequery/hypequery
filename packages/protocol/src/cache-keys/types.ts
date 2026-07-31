/** Absolute limits for cache key version 1 (RFC 0013). */
export const PROTOCOL_CACHE_KEY_LIMITS = {
  minSecretBytes: 32,
  maxPreimageBytes: 1_048_576,
  namespaceTokenBytes: 16,
  entryMacBytes: 32,
  maxStoreKeyBytes: 128,
  minKeyVersion: 1,
  maxKeyVersion: 2_147_483_647,
} as const;

export type ProtocolCacheKeyErrorCode =
  | 'HQ_CACHE_KEY_SECRET_MISSING'
  | 'HQ_CACHE_KEY_SECRET_TOO_SHORT'
  | 'HQ_CACHE_KEY_INVALID_NAMESPACE'
  | 'HQ_CACHE_KEY_INVALID_VERSION'
  | 'HQ_CACHE_KEY_PREIMAGE_TOO_LARGE';

/** The `(project, environment)` pair a cache entry belongs to. */
export interface ProtocolCacheKeyNamespace {
  readonly project: string;
  readonly environment: string;
}

export interface DeriveProtocolCacheKeyOptions {
  /** At least 32 bytes, distinct per namespace, never derived from a name. */
  readonly secret: Uint8Array;
  readonly namespace: ProtocolCacheKeyNamespace;
  /** Increments whenever the namespace secret is rotated. */
  readonly keyVersion: number;
  /** Canonical bytes identifying the query. Stays in memory. */
  readonly preimage: Uint8Array | string;
}
