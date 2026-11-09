interface SemanticResult {
  data: unknown[];
  meta?: {
    timingMs?: number;
    rowCount?: number;
    pagination?: { limit: number; offset: number; hasMore: boolean };
    cache?: { hit: boolean };
  } | null;
}

function isSemanticResult(value: unknown): value is SemanticResult {
  return typeof value === 'object' && value !== null && Array.isArray((value as SemanticResult).data);
}

/**
 * Narrow a pinned request's response to RFC 0018's public metadata:
 * requestId, timingMs, rowCount, pagination and cache hit. A contract client
 * refuses metadata members it does not know, so diagnostics, cache ages and
 * result-limit notes are left out.
 */
export function clientResponse(
  result: unknown,
  requestId: string,
  input: Readonly<Record<string, unknown>>,
): unknown {
  if (!isSemanticResult(result)) return result;
  const { data, meta } = result;
  if (meta === undefined || meta === null) return { data };
  return {
    data,
    meta: {
      requestId,
      timingMs: meta.timingMs ?? 0,
      rowCount: data.length,
      pagination: meta.pagination === undefined
        ? { limit: input.limit as number, offset: input.offset as number, hasMore: false }
        : { limit: meta.pagination.limit, offset: meta.pagination.offset, hasMore: meta.pagination.hasMore },
      ...(meta.cache === undefined ? {} : { cache: { hit: meta.cache.hit } }),
    },
  };
}
