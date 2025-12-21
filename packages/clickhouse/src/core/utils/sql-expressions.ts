/**
 * Represents a raw SQL expression that can be used in queries
 */
export interface SqlExpression<T = unknown> {
  __type: 'expression' | 'aliased_expression';
  toSql(): string;
  readonly expressionType?: T | undefined;
}

/**
 * Represents an aliased SQL expression that can be used in select clauses
 */
export interface AliasedExpression<T = unknown, Alias extends string = string> extends SqlExpression<T> {
  __type: 'aliased_expression';
  alias: Alias;
}

/**
 * Creates a raw SQL expression
 * @param sql The SQL expression string
 * @returns A SqlExpression object
 */
export function raw<T = unknown>(sql: string): SqlExpression<T> {
  return {
    __type: 'expression',
    toSql: () => sql,
    expressionType: undefined as T | undefined
  };
}

/**
 * Creates an aliased SQL expression for use in SELECT clauses
 * @param sql The SQL expression string
 * @param alias The alias to use for the expression
 * @returns An AliasedExpression object
 */
export function rawAs<T = unknown, Alias extends string = string>(sql: string, alias: Alias): AliasedExpression<T, Alias> {
  return {
    __type: 'aliased_expression',
    alias,
    toSql: () => `${sql} AS ${alias}`,
    expressionType: undefined as T | undefined
  };
}

// Helper for common ClickHouse functions

/**
 * Converts a value to DateTime format
 * @param field The field or expression to convert
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export function toDateTime<T extends string = string>(field: string, alias?: T): SqlExpression<Date> | AliasedExpression<Date, T> {
  return alias
    ? rawAs<Date, T>(`toDateTime(${field})`, alias)
    : raw<Date>(`toDateTime(${field})`);
}

export interface FormatDateTimeOptions {
  timezone?: string;
  alias?: string;     // hypequery-specific feature
}

/**
 * Formats a DateTime value using the specified format
 * @param field The field or expression to format
 * @param format The date format string
 * @param options Optional configuration including timezone and alias
 * @returns SQL expression or aliased expression
 */
export function formatDateTime<T extends string = string>(
  field: string,
  format: string,
  options: FormatDateTimeOptions = {}
): SqlExpression<string> | AliasedExpression<string, T> {
  const { timezone, alias } = options;

  let sql = `formatDateTime(${field}, '${format}'`;

  if (timezone) {
    sql += `, '${timezone}'`;
  }

  sql += ')';

  return alias ? rawAs<string, T>(sql, alias as T) : raw<string>(sql);
}

/**
 * Truncates a date/time value to the start of the specified interval
 * @param field The field to truncate
 * @param interval The interval (e.g., '1 day', '15 minute')
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export function toStartOfInterval<T extends string = string>(field: string, interval: string, alias?: T): SqlExpression<Date> | AliasedExpression<Date, T> {
  return alias
    ? rawAs<Date, T>(`toStartOfInterval(${field}, INTERVAL ${interval})`, alias)
    : raw<Date>(`toStartOfInterval(${field}, INTERVAL ${interval})`);
}

/**
 * Extracts the specified part from a date/time value
 * @param part The part to extract (year, month, day, etc.)
 * @param field The field to extract from
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export function datePart<T extends string = string>(part: 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second', field: string, alias?: T): SqlExpression<number> | AliasedExpression<number, T> {
  const functionName = `to${part.charAt(0).toUpperCase() + part.slice(1)}`;
  return alias
    ? rawAs<number, T>(`${functionName}(${field})`, alias)
    : raw<number>(`${functionName}(${field})`);
}
