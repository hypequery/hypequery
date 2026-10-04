import type { DatasetSqlDialect } from '../dataset-sql-dialect.js';
import { quoteSQLIdentifier } from '../sql-utils.js';

/** Preserve the existing ClickHouse spelling and escaping byte for byte. */
export const clickhouseDatasetSqlDialect: DatasetSqlDialect = Object.freeze({
  name: 'clickhouse',
  quoteIdentifier: quoteSQLIdentifier,
});
