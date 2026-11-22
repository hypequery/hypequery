/**
 * RFC 0028 SQL-sourced datasets: definition checks, the derived-table
 * rendering every query reads, and the contract form.
 */
import { analyzeProtocolSqlSource, type ProtocolSqlSourceRefusal } from '@hypequery/protocol';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { isSafeSQLIdentifier } from '../sql-utils.js';
import { stableStringify } from './canonical-json.js';
import type { AnyDatasetInstance, DatasetSqlSource, FieldType, ResolvedDatasetSqlSource } from '../types.js';

const FIELD_TYPES = new Set<string>(['string', 'number', 'boolean', 'timestamp']);

const REFUSALS: Record<ProtocolSqlSourceRefusal, (detail: string | undefined) => string> = {
  'empty': () => 'is empty.',
  'too-large': () => 'is longer than 16 KiB.',
  'invalid-character': () => 'contains a control character, or a non-ASCII character outside a quoted string or identifier.',
  'unterminated-literal': () => 'has an unterminated string or quoted identifier.',
  'multiple-statements': () => 'contains ";". A SQL source is exactly one statement, without a trailing semicolon.',
  'comment': () => 'contains a comment (--, # or /*). Remove it; a SQL source is data, not annotated code.',
  'placeholder': detail => `contains "${detail}". A SQL source is static: it takes no placeholders, parameters or heredoc strings.`,
  'not-select': detail => detail === undefined
    ? 'must be a single SELECT (or WITH … SELECT).'
    : `contains ${detail}. Only SELECT queries are allowed.`,
  'forbidden-clause': detail => `uses ${detail}. Settings, output formats and INTO OUTFILE are refused; quote a column with that name.`,
  'table-function': detail => `reads the table function ${detail}(). Only tables and subqueries may follow FROM or JOIN.`,
  'forbidden-function': detail => `calls ${detail}(), which reads outside the declared tables or blocks.`,
  'system-table': detail => `reads ${detail}. System and information_schema tables are refused.`,
  'unbalanced-parentheses': () => 'has unbalanced parentheses.',
  'unsupported-from': () => 'has a FROM or JOIN target that is neither a table name nor a subquery.',
  'undeclared-dependency': detail => `reads "${detail}", which is not in dependencies. Declare every table the SQL reads, spelled as in the SQL.`,
  'unused-dependency': detail => `never reads declared dependency "${detail}".`,
};

function fail(datasetName: string, message: string): never {
  throw new Error(`Invalid dataset "${datasetName}": ${message}`);
}

export function isDatasetSqlSource(source: unknown): source is DatasetSqlSource {
  return typeof source === 'object' && source !== null && !Array.isArray(source);
}

/** Check a code-first SQL source and freeze it with what the checker found. */
export function resolveDatasetSqlSource(datasetName: string, source: DatasetSqlSource): ResolvedDatasetSqlSource {
  for (const key of Object.keys(source)) {
    if (key !== 'sql' && key !== 'dependencies' && key !== 'columns') {
      fail(datasetName, `source has unknown key "${key}". A SQL source declares sql, dependencies and columns.`);
    }
  }
  if (typeof source.sql !== 'string') fail(datasetName, 'source.sql must be a string.');
  if (!Array.isArray(source.dependencies) || source.dependencies.length === 0) {
    fail(datasetName, 'source.dependencies must list every table the SQL reads.');
  }
  if (source.dependencies.length > 64) fail(datasetName, 'source.dependencies may list at most 64 tables.');
  for (const dependency of source.dependencies) {
    const segments = typeof dependency === 'string' ? dependency.split('.') : [];
    if (segments.length < 1 || segments.length > 2 || !segments.every(isSafeSQLIdentifier)) {
      fail(datasetName, `source dependency "${String(dependency)}" must be "table" or "database.table".`);
    }
  }
  if (new Set(source.dependencies).size !== source.dependencies.length) {
    fail(datasetName, 'source.dependencies must not repeat a table.');
  }
  if (typeof source.columns !== 'object' || source.columns === null || Array.isArray(source.columns)
    || Object.keys(source.columns).length === 0) {
    fail(datasetName, 'source.columns must declare the columns the SQL produces, as { name: type }.');
  }
  for (const [name, type] of Object.entries(source.columns)) {
    if (!isSafeSQLIdentifier(name)) fail(datasetName, `source column "${name}" is not a safe identifier.`);
    if (!FIELD_TYPES.has(type as string)) {
      fail(datasetName, `source column "${name}" has type "${String(type)}". Use string, number, boolean or timestamp.`);
    }
  }
  const analysis = analyzeProtocolSqlSource(source.sql, source.dependencies);
  if (!analysis.ok) fail(datasetName, `source.sql ${REFUSALS[analysis.reason](analysis.detail)}`);
  return Object.freeze({
    sql: source.sql,
    dependencies: Object.freeze([...source.dependencies]),
    columns: Object.freeze({ ...source.columns }),
    readsFinal: analysis.readsFinal,
  });
}

/**
 * The derived table a SQL-sourced dataset reads: only its declared columns,
 * aliased as the dataset so base columns qualify exactly as for a table.
 */
export function sqlSourceRelation(ds: Pick<AnyDatasetInstance, 'source' | 'sqlSource'>): string {
  const source = ds.sqlSource!;
  return `(SELECT ${Object.keys(source.columns).join(', ')} FROM (${source.sql})) AS ${ds.source}`;
}

/** The RFC 0028 contract form. */
export function sqlSourceToContract(source: ResolvedDatasetSqlSource) {
  return {
    kind: 'sql' as const,
    dialect: 'clickhouse' as const,
    sql: source.sql,
    dependencies: [...source.dependencies],
    columns: Object.entries(source.columns).map(([name, type]) => ({ name, type })),
  };
}

/** The code-first form of a contract's SQL source. */
export function sqlSourceFromContract(source: {
  readonly sql: string;
  readonly dependencies: readonly string[];
  readonly columns: readonly { readonly name: string; readonly type: FieldType }[];
}): DatasetSqlSource {
  return {
    sql: source.sql,
    dependencies: [...source.dependencies],
    columns: Object.fromEntries(source.columns.map(column => [column.name, column.type])),
  };
}

/** Lowercase hex SHA-256 of the contract form, for cache identity. */
export function sqlSourceSha256(source: ResolvedDatasetSqlSource): string {
  return bytesToHex(sha256(new TextEncoder().encode(stableStringify(sqlSourceToContract(source)))));
}

/** Refuses a SQL-sourced dataset on paths that read sources by table name. */
export function assertTableSource(ds: Pick<AnyDatasetInstance, 'name' | 'sqlSource'>, context: string): void {
  if (ds.sqlSource) {
    throw new Error(
      `Dataset "${ds.name}" reads a SQL source, which ${context} does not support (RFC 0028). ` +
      'Query it through a ClickHouse query builder, as the base dataset of the query.',
    );
  }
}
