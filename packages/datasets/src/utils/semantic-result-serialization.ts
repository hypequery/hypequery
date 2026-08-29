/**
 * Normalize semantic measure columns to the public wire contract.
 *
 * ClickHouse's JSON formats can return different JavaScript primitives for
 * different aggregate result types. Semantic results expose one stable shape:
 * every non-null measure is a string, while SQL NULL remains null.
 */
export function serializeSemanticMeasureValues<T>(
  rows: readonly T[],
  measureNames: readonly string[],
): T[] {
  return rows.map((row) => {
    if (row === null || typeof row !== 'object') {
      return row;
    }

    const serialized = { ...row } as Record<string, unknown>;
    for (const name of measureNames) {
      const value = serialized[name];
      if (typeof value === 'number' && !Number.isFinite(value)) {
        // ClickHouse JSON output emits NaN and infinities as null by default.
        serialized[name] = null;
      } else if (value != null) {
        serialized[name] = String(value);
      }
    }
    return serialized as T;
  });
}
