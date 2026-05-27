import type { SnapshotDiffResult, MigrationPlanContext, SnapshotOperation } from '@hypequery/schema';
import type { MigrationExecutionClient } from './migration-execution.js';

/**
 * Gather cost context by querying ClickHouse system tables
 * Returns table statistics for affected tables
 */
export async function gatherCostContext(
  client: MigrationExecutionClient,
  diff: SnapshotDiffResult,
): Promise<MigrationPlanContext> {
  const tableNames = extractAffectedTables(diff);

  if (tableNames.length === 0) {
    return {}; // No tables affected
  }

  // SINGLE QUERY for all tables (performance optimization)
  const tableList = tableNames.map(t => `'${t}'`).join(',');

  const result = await client.query({
    query: `
      WITH mutations AS (
        SELECT
          table,
          countIf(is_done = 0) as pending_mutations
        FROM system.mutations
        WHERE database = currentDatabase()
        GROUP BY table
      )
      SELECT
        parts.table,
        sum(parts.rows) as total_rows,
        sum(parts.bytes_on_disk) as total_bytes,
        count() as active_parts,
        coalesce(mutations.pending_mutations, 0) as pending_mutations
      FROM system.parts AS parts
      LEFT JOIN mutations ON mutations.table = parts.table
      WHERE parts.database = currentDatabase()
        AND parts.active = 1
        AND parts.table IN (${tableList})
      GROUP BY parts.table, mutations.pending_mutations
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    table: string;
    total_rows: string;
    total_bytes: string;
    active_parts: string;
    pending_mutations: string;
  }>();

  const tables: Record<string, any> = {};

  for (const row of rows) {
    tables[row.table] = {
      totalRows: Number(row.total_rows),
      totalBytes: Number(row.total_bytes),
      activeParts: Number(row.active_parts),
      pendingMutations: Number(row.pending_mutations),
    };
  }

  return { tables };
}

/**
 * Extract affected table names from diff operations
 */
export function extractAffectedTables(diff: SnapshotDiffResult): string[] {
  const tables = new Set<string>();

  for (const op of diff.operations) {
    const tableName = getOperationTableName(op);
    if (tableName) {
      tables.add(tableName);
    }
  }

  return Array.from(tables);
}

/**
 * Get table name from operation (internal helper)
 */
function getOperationTableName(operation: SnapshotOperation): string | null {
  switch (operation.kind) {
    case 'CreateTable':
    case 'DropTable':
      return operation.tableName;
    case 'AddColumn':
    case 'DropColumn':
    case 'ModifyColumnType':
    case 'ModifyColumnDefault':
      return operation.table;
    case 'CreateMaterializedView':
    case 'DropMaterializedView':
      return operation.viewName;
    case 'AlterTableWithMaterializedViewRecreate':
      return operation.targetTable;
    default:
      return null;
  }
}
