import type { DatasetRawSqlExpressionError, DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { AnyDatasetInstance } from '../types.js';
import { clickhouseDatasetSqlDialect } from './clickhouse-dataset-sql-dialect.js';

export function rawSqlErrorMessage(kind: 'dimension' | 'measure', name: string, error: DatasetRawSqlExpressionError): string {
  return error === 'unterminated-literal'
    ? `${kind} "${name}" sql has an unterminated quoted literal.`
    : `${kind} "${name}" sql must be a single expression without statement terminators or `
      + 'comments (";", "--", "/*") outside a quoted literal.';
}

const checked = new WeakMap<AnyDatasetInstance, WeakSet<DatasetSqlDialectRules>>();

/**
 * Re-check a dataset's raw `sql` fields under the active engine's lexical
 * rules before planning. Definitions are validated with ClickHouse rules, and
 * engines disagree on what hides a terminator: with standard-conforming
 * strings, `'\'; DROP TABLE x; --'` ends its literal early on Postgres. A
 * ClickHouse-rule dialect is skipped; it was checked at definition time.
 */
export function assertRawSqlForDialect(ds: AnyDatasetInstance, dialect: DatasetSqlDialectRules): void {
  if (dialect.rawSqlExpressionError === clickhouseDatasetSqlDialect.rawSqlExpressionError) return;
  let dialects = checked.get(ds);
  if (dialects?.has(dialect)) return;
  const fields: ['dimension' | 'measure', string, string | undefined][] = [
    ...Object.entries(ds.dimensions).map(([name, definition]) => ['dimension', name, definition.sql] as ['dimension', string, string | undefined]),
    ...Object.entries(ds.measures).map(([name, definition]) => ['measure', name, 'sql' in definition ? definition.sql as string | undefined : undefined] as ['measure', string, string | undefined]),
  ];
  for (const [kind, name, sql] of fields) {
    if (sql === undefined) continue;
    const error = dialect.rawSqlExpressionError(sql);
    if (error) {
      throw new Error(`Invalid dataset "${ds.name}" for the ${dialect.name} datasets dialect: ${rawSqlErrorMessage(kind, name, error)}`);
    }
  }
  if (!dialects) checked.set(ds, dialects = new WeakSet());
  dialects.add(dialect);
}
