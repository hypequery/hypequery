import type { AuthContext } from '../../../types.js';

/** Authorization is server code; metadata opt-in alone never grants access. */
export interface SemanticDiagnosticAccess<TAuth extends AuthContext = AuthContext> {
  authorize: (auth: TAuth) => boolean | Promise<boolean>;
  audit: (auth: TAuth) => void | Promise<void>;
}

export interface OperationalQueryMeta {
  timingMs?: number;
  rowCount?: number;
  pagination?: { limit: number; offset: number; hasMore: boolean };
  cache?: { hit: boolean; ageMs?: number; stale?: boolean };
}

export function publicQueryMetadata(meta: OperationalQueryMeta | undefined): OperationalQueryMeta {
  return {
    ...(meta?.timingMs !== undefined ? { timingMs: meta.timingMs } : {}),
    ...(meta?.rowCount !== undefined ? { rowCount: meta.rowCount } : {}),
    ...(meta?.pagination !== undefined ? {
      pagination: {
        limit: meta.pagination.limit,
        offset: meta.pagination.offset,
        hasMore: meta.pagination.hasMore,
      },
    } : {}),
    cache: {
      hit: meta?.cache?.hit ?? false,
      ...(meta?.cache?.ageMs !== undefined ? { ageMs: meta.cache.ageMs } : {}),
      ...(meta?.cache?.stale !== undefined ? { stale: meta.cache.stale } : {}),
    },
  };
}

export async function authorizedQueryDiagnostics<TAuth extends AuthContext>(
  access: SemanticDiagnosticAccess<TAuth> | undefined,
  auth: TAuth | null,
  meta: { sql?: string; tenant?: string } | undefined,
): Promise<{ sql?: string; tenant?: string } | undefined> {
  if (!access || !auth || await access.authorize(auth) !== true) return undefined;
  await access.audit(auth);
  return {
    ...(meta?.sql !== undefined ? { sql: meta.sql } : {}),
    ...(meta?.tenant !== undefined ? { tenant: meta.tenant } : {}),
  };
}
