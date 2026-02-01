import type { OutputColumnType } from '../../types/base.js';
import type { ColumnType } from '../../types/schema.js';

/**
 * Map a ClickHouse type string (e.g. 'Float64', 'Int32', 'String', 'Bool')
 * to a JS coercion target. Returns undefined for types that don't need
 * coercion (e.g. DateTime stays as string, which is correct).
 */
export function clickHouseTypeToCoercion(chType: ColumnType): OutputColumnType | undefined {
  const t = chType as string;

  // Unwrap Nullable/LowCardinality to get the base type
  const unwrapped = t
    .replace(/^Nullable\(/, '').replace(/\)$/, '')
    .replace(/^LowCardinality\(/, '').replace(/\)$/, '');

  // Integers
  if (/^U?Int\d+$/.test(unwrapped)) return 'number';
  // Floats
  if (/^Float\d+$/.test(unwrapped)) return 'number';
  // Decimals
  if (/^Decimal/.test(unwrapped)) return 'number';
  // Boolean
  if (unwrapped === 'Bool' || unwrapped === 'Boolean') return 'boolean';

  // String, UUID, DateTime, Date, Enum, etc. — leave as string (no coercion needed)
  return undefined;
}

/**
 * Coerce a single value to the target JS type.
 * ClickHouse JSON returns some numeric results as strings
 * (e.g. Decimal aggregations, large integers). This converts
 * them to the correct JS type based on the outputColumns hints.
 */
function coerceValue(value: unknown, target: OutputColumnType): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  switch (target) {
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        // Preserve the original string if it's not a valid number
        // (e.g. 'NaN', 'Infinity', or non-numeric strings)
        return Number.isFinite(parsed) ? parsed : value;
      }
      return value;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      // ClickHouse Bool returns 0/1 or true/false
      if (value === 1 || value === '1' || value === 'true') return true;
      if (value === 0 || value === '0' || value === 'false') return false;
      return value;
    }
    case 'string': {
      if (typeof value === 'string') return value;
      return String(value);
    }
    default:
      return value;
  }
}

/**
 * Apply type coercion to an array of result rows based on outputColumns hints.
 * Only processes columns that have explicit hints — leaves all other values untouched.
 * Mutates rows in place for performance (avoids allocation for large result sets).
 */
export function coerceRows<T>(
  rows: T[],
  outputColumns: Record<string, OutputColumnType> | undefined
): T[] {
  if (!outputColumns) return rows;

  const entries = Object.entries(outputColumns);
  if (entries.length === 0) return rows;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Record<string, unknown>;
    for (let j = 0; j < entries.length; j++) {
      const [column, targetType] = entries[j];
      if (column in row) {
        row[column] = coerceValue(row[column], targetType);
      }
    }
  }

  return rows;
}
