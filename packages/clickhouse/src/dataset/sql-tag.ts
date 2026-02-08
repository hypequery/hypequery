/**
 * SQL Tagged Template Literal
 *
 * Marks a string as a SQL expression rather than a column reference.
 * Used to distinguish between:
 * - Simple column: 'region' (string)
 * - SQL expression: sql`DATE(created_at)` (SQLExpression)
 *
 * @example
 * ```typescript
 * dimensions: {
 *   region: 'region',  // Simple column reference
 *   date: sql`DATE(created_at)`,  // SQL expression
 *   hour: sql`toHour(created_at)`  // SQL expression
 * }
 * ```
 */

/**
 * Represents a SQL expression with metadata
 */
export interface SQLExpression {
  readonly __brand: 'SQLExpression';
  readonly sql: string;
  readonly raw: boolean;
}

/**
 * Tagged template literal for SQL expressions
 *
 * @param strings - Template string array
 * @param values - Interpolated values
 * @returns SQLExpression object
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SQLExpression {
  // Build the SQL string by interleaving strings and values
  let result = strings[0];

  for (let i = 0; i < values.length; i++) {
    const value = values[i];

    // Handle nested SQL expressions
    if (isSQLExpression(value)) {
      result += value.sql;
    } else if (typeof value === 'string') {
      // For security, we should escape string values
      // In production, this would use proper escaping
      result += value;
    } else if (typeof value === 'number') {
      result += String(value);
    } else if (value === null || value === undefined) {
      result += 'NULL';
    } else {
      // For other types, convert to string
      result += String(value);
    }

    result += strings[i + 1];
  }

  return {
    __brand: 'SQLExpression',
    sql: result,
    raw: true,
  };
}

/**
 * Type guard to check if a value is a SQLExpression
 *
 * @param value - Value to check
 * @returns True if value is a SQLExpression
 */
export function isSQLExpression(value: unknown): value is SQLExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__brand' in value &&
    value.__brand === 'SQLExpression'
  );
}

/**
 * Convert a value to a SQL string
 * - If it's a SQLExpression, return the sql property
 * - If it's a string, return it as-is (assumed to be a column name)
 * - Otherwise, throw an error
 *
 * @param value - Value to convert
 * @returns SQL string
 */
export function toSQLString(value: string | SQLExpression): string {
  if (typeof value === 'string') {
    return value;
  }

  if (isSQLExpression(value)) {
    return value.sql;
  }

  throw new Error(
    `Expected string or SQLExpression, got ${typeof value}`
  );
}
