/**
 * SQL utility functions for safe SQL generation.
 */

/**
 * Validates that a string is a safe SQL identifier (column/table name).
 * Allows only alphanumeric characters and underscores, starting with letter or underscore.
 *
 * @param identifier - The identifier to validate
 * @returns true if valid, false otherwise
 */
export function isSafeSQLIdentifier(identifier: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
}

/**
 * Validates and throws if identifier is not safe for SQL.
 *
 * @param identifier - The identifier to validate
 * @param context - Context for error message (e.g., "dimension name", "field name")
 * @throws Error if identifier is not safe
 */
export function validateSQLIdentifier(identifier: string, context: string): void {
  if (!isSafeSQLIdentifier(identifier)) {
    throw new Error(
      `Invalid ${context}: "${identifier}". Must contain only letters, numbers, and underscores, ` +
      `and start with a letter or underscore.`
    );
  }
}

/**
 * Quotes a SQL identifier for safe use in queries.
 * Uses backticks, which is how ClickHouse quotes identifiers.
 *
 * @param identifier - The identifier to quote
 * @returns Quoted identifier
 */
export function quoteSQLIdentifier(identifier: string): string {
  // Escape any existing backticks by doubling them
  const escaped = identifier.replace(/`/g, '``');
  return `\`${escaped}\``;
}
