export type EventResultValue = string | number | boolean | null;
export type EventResultRow = Readonly<Record<string, EventResultValue>>;

/** A ClickHouse count arrives as a number or, for 64-bit types, a quoted string. */
export function countValue(value: unknown): number {
  const count = typeof value === 'string' ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('The executor returned a count that is not a non-negative integer.');
  }
  return count;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** A result cell: scalars pass through; anything else becomes its string form. */
export function scalar(value: unknown): EventResultValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return String(value);
}
