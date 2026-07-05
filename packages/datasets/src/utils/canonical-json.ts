/**
 * Canonical serialization helpers shared by everything that needs stable,
 * environment-independent output — contract hashing (contract.ts) and
 * semantic cache keys (cache/query-signature.ts). Keep ordering logic here so
 * the two paths cannot drift apart.
 */

/**
 * Locale-independent string comparison by UTF-16 code unit. Used everywhere
 * canonical output sorts, so hashes and cache keys are stable across
 * environments (CI ICU versions, locales) rather than depending on
 * `localeCompare`.
 */
export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Builds an object whose keys are inserted in sorted order for stable JSON. */
export function sortedRecord<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => compareStrings(left, right)),
  );
}

/** Deduplicates and sorts a list so logically-equal sets serialize identically. */
export function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort(compareStrings);
}

/** JSON.stringify with recursively sorted object keys, so key order never matters. */
export function stableStringify(value: unknown): string {
  if (typeof value === 'bigint') {
    // JSON.stringify throws on bigint. The `n` suffix keeps 1n distinct from
    // both the number 1 and the string "1n" (strings serialize with quotes).
    return `${value}n`;
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const toJSON = (value as { toJSON?: () => unknown }).toJSON;
  if (typeof toJSON === 'function') {
    // Match JSON.stringify semantics for Dates and other toJSON carriers.
    // Without this, every Date serializes to '{}' (no enumerable props) and
    // distinct date filters collapse onto one cache key.
    return stableStringify(toJSON.call(value));
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}
