/**
 * Represents a raw SQL expression that can be used in queries
 */
export interface SqlExpression {
  __type: string;
  toSql(): string;
}

/**
 * Represents an aliased SQL expression that can be used in select clauses
 */
export interface AliasedExpression extends SqlExpression {
  __type: 'aliased_expression';
  alias: string;
}

/**
 * Creates a raw SQL expression
 * @param sql The SQL expression string
 * @returns A SqlExpression object
 */
export function raw(sql: string): SqlExpression {
  return {
    __type: 'expression',
    toSql: () => sql
  };
}

/**
 * Creates an aliased SQL expression for use in SELECT clauses
 * @param sql The SQL expression string
 * @param alias The alias to use for the expression
 * @returns An AliasedExpression object
 */
export function rawAs(sql: string, alias: string): AliasedExpression {
  return {
    __type: 'aliased_expression',
    alias,
    toSql: () => `${sql} AS ${alias}`
  };
}

// Helper for common ClickHouse functions

/**
 * Converts a value to DateTime format
 * @param field The field or expression to convert
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export function toDateTime(field: string, alias?: string): SqlExpression | AliasedExpression {
  return alias
    ? rawAs(`toDateTime(${field})`, alias)
    : raw(`toDateTime(${field})`);
}

/**
 * Formats a DateTime value using the specified format
 * @param field The field or expression to format
 * @param format The date format string
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export function formatDateTime(field: string, format: string, alias?: string): SqlExpression | AliasedExpression {
  return alias
    ? rawAs(`formatDateTime(${field}, '${format}')`, alias)
    : raw(`formatDateTime(${field}, '${format}')`);
}

/**
 * Truncates a date/time value to the start of the specified interval
 * @param field The field to truncate
 * @param interval The interval (e.g., '1 day', '15 minute')
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export function toStartOfInterval(field: string, interval: string, alias?: string): SqlExpression | AliasedExpression {
  return alias
    ? rawAs(`toStartOfInterval(${field}, INTERVAL ${interval})`, alias)
    : raw(`toStartOfInterval(${field}, INTERVAL ${interval})`);
}

/**
 * Extracts the specified part from a date/time value
 * @param part The part to extract (year, month, day, etc.)
 * @param field The field to extract from
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export function datePart(part: 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second', field: string, alias?: string): SqlExpression | AliasedExpression {
  const functionName = `to${part.charAt(0).toUpperCase() + part.slice(1)}`;
  return alias
    ? rawAs(`${functionName}(${field})`, alias)
    : raw(`${functionName}(${field})`);
} 