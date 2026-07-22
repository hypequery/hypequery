export const ensureArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

export const mergeTags = (existing: string[], next?: string[]) => {
  const merged = [...existing, ...(next ?? [])];
  return Array.from(new Set(merged.filter(Boolean)));
};

export const generateRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Upper bound on an accepted external correlation id, in UTF-8 bytes. */
export const MAX_CORRELATION_ID_BYTES = 200;

// C0 controls, DEL, and C1 controls — rejected so a caller-supplied correlation id can
// never inject newlines/control sequences into logs or response headers.
// eslint-disable-next-line no-control-regex -- control chars are exactly what we reject
const CORRELATION_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const correlationIdEncoder = new TextEncoder();

/**
 * Validate a caller-supplied external correlation id (e.g. `x-request-id`). This value is
 * never authoritative — the authoritative request id is generated server-side. Returns the
 * trimmed value when it is a safe, bounded string, or `undefined` when absent or rejected
 * (empty, control characters, or over {@link MAX_CORRELATION_ID_BYTES}).
 */
export const validateCorrelationId = (value?: string): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (CORRELATION_CONTROL_CHARS.test(trimmed)) return undefined;
  if (correlationIdEncoder.encode(trimmed).length > MAX_CORRELATION_ID_BYTES) return undefined;
  return trimmed;
};

export const normalizeHeaderMap = (
  headers: Record<string, string | undefined> = {}
): Record<string, string | undefined> => {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
};
