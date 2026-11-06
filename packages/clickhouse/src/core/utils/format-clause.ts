/**
 * Appends a `FORMAT` clause to a statement for endpoints that take the format
 * from the SQL. It goes on its own line so a trailing `--` comment cannot
 * swallow it, after any trailing `;`, which ClickHouse would reject before it.
 */
export function withFormatClause(sql: string, format: string): string {
  return `${sql.replace(/[\s;]+$/, '')}\nFORMAT ${format}`;
}
