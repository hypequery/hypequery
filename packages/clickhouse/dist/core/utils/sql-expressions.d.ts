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
export declare function raw<T = unknown>(sql: string): SqlExpression<T>;
export declare function selectExpr<T = unknown>(sql: string): SqlExpression<T>;
export declare function selectExpr<T = unknown, Alias extends string = string>(sql: string, alias: Alias): AliasedExpression<T, Alias>;
/**
 * Creates an aliased SQL expression for use in SELECT clauses
 * @param sql The SQL expression string
 * @param alias The alias to use for the expression
 * @returns An AliasedExpression object
 */
export declare function rawAs<T = unknown, Alias extends string = string>(sql: string, alias: Alias): AliasedExpression<T, Alias>;
/**
 * Converts a value to DateTime format
 * @param field The field or expression to convert
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export declare function toDateTime(field: string): SqlExpression<Date>;
export declare function toDateTime<T extends string>(field: string, alias: T): AliasedExpression<Date, T>;
export interface FormatDateTimeOptions {
    timezone?: string;
    alias?: string;
}
type FormatDateTimeAliasOptions<Alias extends string> = FormatDateTimeOptions & {
    alias: Alias;
};
type FormatDateTimeNoAliasOptions = Omit<FormatDateTimeOptions, 'alias'> & {
    alias?: undefined;
};
/**
 * Formats a DateTime value using the specified format
 * @param field The field or expression to format
 * @param format The date format string
 * @param options Optional configuration including timezone and alias
 * @returns SQL expression or aliased expression
 */
export declare function formatDateTime(field: string, format: string, options?: FormatDateTimeNoAliasOptions): SqlExpression<string>;
export declare function formatDateTime<T extends string>(field: string, format: string, options: FormatDateTimeAliasOptions<T>): AliasedExpression<string, T>;
/**
 * Truncates a date/time value to the start of the specified interval
 * @param field The field to truncate
 * @param interval The interval (e.g., '1 day', '15 minute')
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export declare function toStartOfInterval(field: string, interval: string): SqlExpression<Date>;
export declare function toStartOfInterval<T extends string>(field: string, interval: string, alias: T): AliasedExpression<Date, T>;
/**
 * Extracts the specified part from a date/time value
 * @param part The part to extract (year, month, day, etc.)
 * @param field The field to extract from
 * @param alias Optional alias for the result
 * @returns SQL expression or aliased expression
 */
export declare function datePart(part: 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second', field: string): SqlExpression<number>;
export declare function datePart<T extends string>(part: 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second', field: string, alias: T): AliasedExpression<number, T>;
export {};
//# sourceMappingURL=sql-expressions.d.ts.map