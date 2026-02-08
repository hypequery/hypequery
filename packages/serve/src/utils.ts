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

export const normalizeHeaderMap = (
  headers: Record<string, string | undefined> = {}
): Record<string, string | undefined> => {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
};
