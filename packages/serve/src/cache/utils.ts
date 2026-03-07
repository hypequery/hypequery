/**
 * Generate a stable cache key from endpoint key and input.
 * Uses JSON serialization with sorted keys for consistency.
 */
export function generateCacheKey(endpointKey: string, input: unknown): string {
  if (input === undefined || input === null) {
    return `hq:${endpointKey}`;
  }

  try {
    const normalized = stableStringify(input);
    return `hq:${endpointKey}:${normalized}`;
  } catch {
    // Fallback for non-serializable inputs
    return `hq:${endpointKey}:${String(input)}`;
  }
}

/**
 * Stable JSON stringify that sorts object keys.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Parse Cache-Control header to check for no-cache/no-store directives.
 */
export function shouldBypassCache(headers: Record<string, string | undefined>): boolean {
  const cacheControl = headers['cache-control']?.toLowerCase() ?? '';
  return cacheControl.includes('no-cache') || cacheControl.includes('no-store');
}

/**
 * Check if a request explicitly wants a fresh response.
 */
export function wantsFreshResponse(headers: Record<string, string | undefined>): boolean {
  // Cache-Control: no-cache
  if (shouldBypassCache(headers)) {
    return true;
  }

  // Pragma: no-cache (HTTP/1.0 compatibility)
  if (headers['pragma']?.toLowerCase() === 'no-cache') {
    return true;
  }

  return false;
}
