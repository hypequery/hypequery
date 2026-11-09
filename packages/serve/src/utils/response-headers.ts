/** Header names compared case-insensitively. */
const sameHeader = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const withoutHeader = (headers: Record<string, string> | undefined, name: string) =>
  Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => !sameHeader(key, name)));

const findHeader = (headers: Record<string, string> | undefined, name: string) =>
  Object.entries(headers ?? {}).find(([key]) => sameHeader(key, name))?.[1];

/**
 * *headers* with `content-type` set to *value*, replacing it in any casing, so
 * a runtime that combines duplicate names never sends two types.
 */
export function withContentType(
  headers: Record<string, string> | undefined,
  value: string,
): Record<string, string> {
  return { ...withoutHeader(headers, 'content-type'), 'content-type': value };
}

/** *headers* with `content-type` defaulted to *value* when absent in any casing. */
export function withDefaultContentType(
  headers: Record<string, string> | undefined,
  value: string,
): Record<string, string> {
  return findHeader(headers, 'content-type') === undefined
    ? { 'content-type': value, ...headers }
    : { ...headers };
}

/**
 * *extra* applied over *base*, matching names in any casing. `vary` combines
 * instead, so `Vary: Accept` on an endpoint survives CORS adding `Vary: Origin`.
 */
export function mergeResponseHeaders(
  base: Record<string, string> | undefined,
  extra: Record<string, string>,
): Record<string, string> {
  let merged: Record<string, string> = { ...base };
  for (const [name, value] of Object.entries(extra)) {
    const existing = findHeader(merged, name);
    merged = withoutHeader(merged, name);
    merged[name] = sameHeader(name, 'vary') && existing !== undefined
      ? combineVary(existing, value)
      : value;
  }
  return merged;
}

const combineVary = (a: string, b: string) => {
  const fields: string[] = [];
  for (const field of `${a},${b}`.split(',').map(part => part.trim()).filter(Boolean)) {
    if (!fields.some(seen => sameHeader(seen, field))) fields.push(field);
  }
  return fields.join(', ');
};
