/**
 * Infers the appropriate ClickHouse type for a JavaScript value.
 * Used for native parameter binding with query_params.
 *
 * @param value - The JavaScript value to infer a type for
 * @returns The ClickHouse type string (e.g., "Int64", "String", "Array(Int64)")
 */
export function inferClickHouseType(value: unknown): string {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return 'Nullable(String)';
  }

  // Number types
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return 'Float64';
    }
    return Number.isInteger(value) ? 'Int64' : 'Float64';
  }

  // String type
  if (typeof value === 'string') {
    return 'String';
  }

  // Boolean type
  if (typeof value === 'boolean') {
    return 'Bool';
  }

  // Date type
  if (value instanceof Date) {
    return 'DateTime';
  }

  // Array types
  if (Array.isArray(value)) {
    if (value.length === 0) {
      // Empty array defaults to Array(String)
      return 'Array(String)';
    }
    // Infer type from first element
    const firstType = inferClickHouseType(value[0]);
    return `Array(${firstType})`;
  }

  // Objects and other types fallback to String (will be JSON stringified)
  return 'String';
}
