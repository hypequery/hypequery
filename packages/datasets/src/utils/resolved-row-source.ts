import { validateProtocolRowResolution } from '@hypequery/protocol';
import type { AnyDatasetInstance } from '../types.js';
import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';

/** Physical relation rendered once, shared by base, relationship, and time scans. */
export function resolvedRowSource(ds: Pick<AnyDatasetInstance, 'source' | 'rowResolution'>, dialect: DatasetSqlDialectRules): string {
  const source = dialect.quoteQualifiedName(ds.source);
  if (!ds.rowResolution) return source;
  if (dialect.name !== 'clickhouse') throw new Error('Resolved rows require the ClickHouse dataset SQL dialect.');
  const policy = validateProtocolRowResolution(ds.rowResolution);
  const predicate = policy.engine === 'replacing'
    ? policy.deletedColumn === undefined ? '' : `${dialect.quoteIdentifier(policy.deletedColumn)} = 0`
    : `${dialect.quoteIdentifier(policy.signColumn)} = 1`;
  // WHERE must run after FINAL. Do not let a non-key deletion/status predicate
  // become PREWHERE and resurrect an older row. The scope owns these settings.
  return `(SELECT * FROM ${source} FINAL${predicate ? ` WHERE ${predicate}` : ''} SETTINGS optimize_move_to_prewhere = 0, optimize_move_to_prewhere_if_final = 0)`;
}

/** Base scans need the same table qualifier used by relationship expressions. */
export function datasetBuilderSource(ds: AnyDatasetInstance, dialect: DatasetSqlDialectRules): string {
  if (!ds.rowResolution) return ds.source;
  return `${resolvedRowSource(ds, dialect)} AS ${dialect.quoteIdentifier(resolvedSourceQualifier(ds))}`;
}

export function resolvedSourceQualifier(ds: Pick<AnyDatasetInstance, 'source' | 'rowResolution'>): string {
  return ds.rowResolution ? ds.source.split('.').at(-1)! : ds.source;
}

export function rejectResolvedRowsOnBackend(ds: AnyDatasetInstance): void {
  if (ds.rowResolution) throw new Error('Resolved rows require the queryBuilder execution path; semantic backends cannot resolve physical versions.');
}
