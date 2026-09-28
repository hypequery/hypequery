/** Stable failure codes for cache preimage version 1 (RFC 0009). */
export type ProtocolCachePreimageErrorCode =
  | 'HQ_CACHE_PREIMAGE_SECRET_MISSING'
  | 'HQ_CACHE_PREIMAGE_SECRET_TOO_SHORT'
  | 'HQ_CACHE_PREIMAGE_INVALID_DEFINITION'
  | 'HQ_CACHE_PREIMAGE_INVALID_QUERY'
  | 'HQ_CACHE_PREIMAGE_INVALID_TENANT'
  | 'HQ_CACHE_PREIMAGE_INVALID_LIMIT';

/**
 * The tenant scope an execution runs under, as resolved server-side.
 *
 * `all` is a trusted execution the runtime itself scopes to every tenant. It
 * is never reachable from a request and is not the cross-tenant administrative
 * capability, which never touches the data plane.
 */
export type ProtocolCacheTenantScope =
  | { readonly mode: 'none' }
  | { readonly mode: 'scoped'; readonly ids: readonly string[] }
  | { readonly mode: 'all' };

export interface BuildProtocolCachePreimageOptions {
  /** The namespace's RFC 0013 cache-key secret; keys tenant fingerprints. */
  readonly secret: Uint8Array;
  /** 64 lowercase hex characters; the RFC 0007 bundle identity when released. */
  readonly definitionIdentity: string;
  /** An RFC 0003 semantic query, validated under expression extension 2. */
  readonly query: unknown;
  readonly tenant: ProtocolCacheTenantScope;
  /** The effective maximum row count, or `null` when none applies. */
  readonly rowLimit: number | null;
}
