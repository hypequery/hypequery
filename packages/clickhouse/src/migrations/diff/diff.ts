import type {
  Snapshot,
  SnapshotColumn,
  SnapshotMaterializedView,
  SnapshotTable,
} from '../snapshot/types.js';
import type {
  CreateMaterializedViewOperation,
  CreateTableOperation,
  DiffWarning,
  DropMaterializedViewOperation,
  DropTableOperation,
  MigrationOperation,
  RecreateMaterializedViewOperation,
  SnapshotDiffResult,
  TableMutationOperation,
  UnsupportedChange,
} from './types.js';

/**
 * Computes migration operations needed to move from one snapshot to another.
 *
 * The diff layer is deliberately SQL-free. It emits structured operations,
 * warnings for potentially expensive changes, and unsupported-change diagnostics
 * that the SQL renderer refuses to render automatically.
 */
export function diffSnapshots(previousSnapshot: Snapshot, nextSnapshot: Snapshot): SnapshotDiffResult {
  const warnings: DiffWarning[] = [];
  const unsupportedChanges: UnsupportedChange[] = [];

  const previousTables = toNameMap(previousSnapshot.tables);
  const nextTables = toNameMap(nextSnapshot.tables);
  const previousViews = toNameMap(previousSnapshot.materializedViews);
  const nextViews = toNameMap(nextSnapshot.materializedViews);

  const dropMaterializedViewOperations = diffDroppedMaterializedViews(previousViews, nextViews);
  const dropTableOperations = diffDroppedTables(previousTables, nextTables);
  const tableOperations = diffTables(
    previousSnapshot,
    nextSnapshot,
    previousTables,
    nextTables,
    warnings,
    unsupportedChanges,
  );
  const createTableOperations = diffCreatedTables(previousTables, nextTables);
  const recreateMaterializedViewOperations = diffChangedMaterializedViews(previousViews, nextViews);
  const createMaterializedViewOperations = diffCreatedMaterializedViews(previousViews, nextViews);

  return {
    previousSnapshot,
    nextSnapshot,
    operations: [
      ...dropMaterializedViewOperations,
      ...dropTableOperations,
      ...tableOperations,
      ...createTableOperations,
      ...recreateMaterializedViewOperations,
      ...createMaterializedViewOperations,
    ],
    warnings,
    unsupportedChanges,
  };
}

function diffDroppedMaterializedViews(
  previousViews: Map<string, SnapshotMaterializedView>,
  nextViews: Map<string, SnapshotMaterializedView>,
): DropMaterializedViewOperation[] {
  return [...previousViews.values()]
    .filter(view => !nextViews.has(view.name))
    .map(view => ({
      kind: 'DropMaterializedView',
      viewName: view.name,
    }));
}

function diffDroppedTables(
  previousTables: Map<string, SnapshotTable>,
  nextTables: Map<string, SnapshotTable>,
): DropTableOperation[] {
  return [...previousTables.values()]
    .filter(table => !nextTables.has(table.name))
    .map(table => ({
      kind: 'DropTable',
      tableName: table.name,
    }));
}

function diffCreatedTables(
  previousTables: Map<string, SnapshotTable>,
  nextTables: Map<string, SnapshotTable>,
): CreateTableOperation[] {
  return [...nextTables.values()]
    .filter(table => !previousTables.has(table.name))
    .map(table => ({
      kind: 'CreateTable',
      table,
    }));
}

function diffCreatedMaterializedViews(
  previousViews: Map<string, SnapshotMaterializedView>,
  nextViews: Map<string, SnapshotMaterializedView>,
): CreateMaterializedViewOperation[] {
  return [...nextViews.values()]
    .filter(view => !previousViews.has(view.name))
    .map(view => ({
      kind: 'CreateMaterializedView',
      view,
    }));
}

function diffChangedMaterializedViews(
  previousViews: Map<string, SnapshotMaterializedView>,
  nextViews: Map<string, SnapshotMaterializedView>,
): RecreateMaterializedViewOperation[] {
  const operations: RecreateMaterializedViewOperation[] = [];

  for (const previousView of previousViews.values()) {
    const nextView = nextViews.get(previousView.name);
    if (!nextView) {
      continue;
    }

    if (!isSameMaterializedView(previousView, nextView)) {
      operations.push({
        kind: 'RecreateMaterializedView',
        previousView,
        nextView,
      });
    }
  }

  return operations;
}

function diffTables(
  previousSnapshot: Snapshot,
  nextSnapshot: Snapshot,
  previousTables: Map<string, SnapshotTable>,
  nextTables: Map<string, SnapshotTable>,
  warnings: DiffWarning[],
  unsupportedChanges: UnsupportedChange[],
): MigrationOperation[] {
  const operations: MigrationOperation[] = [];

  for (const previousTable of previousTables.values()) {
    const nextTable = nextTables.get(previousTable.name);
    if (!nextTable) {
      continue;
    }

    if (!isSameTableEngine(previousTable.engine, nextTable.engine)) {
      unsupportedChanges.push({
        kind: 'TableEngineChanged',
        tableName: previousTable.name,
        message: `Table engine changed for "${previousTable.name}". Engine evolution is not auto-generated yet.`,
      });
    }

    if (!isSameSettings(previousTable.settings, nextTable.settings)) {
      unsupportedChanges.push({
        kind: 'TableSettingsChanged',
        tableName: previousTable.name,
        message: `Table settings changed for "${previousTable.name}". Settings diffs are not auto-generated yet.`,
      });
    }

    const tableMutations = diffColumns(previousTable, nextTable, warnings, unsupportedChanges);
    if (tableMutations.length === 0) {
      continue;
    }

    const dependentViewNames = getDependentViewNames(previousSnapshot, nextSnapshot, previousTable.name);
    if (dependentViewNames.length > 0) {
      operations.push({
        kind: 'AlterTableWithDependentViews',
        tableName: previousTable.name,
        dependentViewNames,
        operations: tableMutations,
      });
      continue;
    }

    operations.push(...tableMutations);
  }

  return operations;
}

function diffColumns(
  previousTable: SnapshotTable,
  nextTable: SnapshotTable,
  warnings: DiffWarning[],
  unsupportedChanges: UnsupportedChange[],
): TableMutationOperation[] {
  const operations: TableMutationOperation[] = [];
  const previousColumns = toNameMap(previousTable.columns);
  const nextColumns = toNameMap(nextTable.columns);

  const droppedColumns = [...previousColumns.values()].filter(column => !nextColumns.has(column.name));
  const addedColumns = [...nextColumns.values()].filter(column => !previousColumns.has(column.name));

  detectPossibleRenames(previousTable.name, droppedColumns, addedColumns, unsupportedChanges);

  for (const column of droppedColumns) {
    operations.push({
      kind: 'DropColumn',
      tableName: previousTable.name,
      columnName: column.name,
    });
  }

  for (const column of addedColumns) {
    operations.push({
      kind: 'AddColumn',
      tableName: previousTable.name,
      column,
    });
  }

  for (const previousColumn of previousColumns.values()) {
    const nextColumn = nextColumns.get(previousColumn.name);
    if (!nextColumn) {
      continue;
    }

    if (previousColumn.type !== nextColumn.type) {
      operations.push({
        kind: 'ModifyColumnType',
        tableName: previousTable.name,
        columnName: previousColumn.name,
        previousType: previousColumn.type,
        nextType: nextColumn.type,
      });
      warnings.push({
        kind: 'ModifyColumnTypeRequiresConfirmation',
        tableName: previousTable.name,
        columnName: previousColumn.name,
        message:
          `Column type changed for "${previousTable.name}.${previousColumn.name}" ` +
          `from "${previousColumn.type}" to "${nextColumn.type}".`,
      });
    }

    if (!isSameColumnDefault(previousColumn.default, nextColumn.default)) {
      operations.push({
        kind: 'ModifyColumnDefault',
        tableName: previousTable.name,
        columnName: previousColumn.name,
        previousDefault: previousColumn.default,
        nextDefault: nextColumn.default,
      });
    }
  }

  return operations;
}

function isSameColumnDefault(left?: SnapshotColumn['default'], right?: SnapshotColumn['default']) {
  if (left === right) {
    return true;
  }

  if (left === undefined || right === undefined) {
    return false;
  }

  return left.kind === right.kind && left.value === right.value;
}

function detectPossibleRenames(
  tableName: string,
  droppedColumns: SnapshotColumn[],
  addedColumns: SnapshotColumn[],
  unsupportedChanges: UnsupportedChange[],
) {
  for (const droppedColumn of droppedColumns) {
    const renameCandidate = addedColumns.find(
      addedColumn =>
        addedColumn.type === droppedColumn.type &&
        isSameColumnDefault(addedColumn.default, droppedColumn.default),
    );

    if (!renameCandidate) {
      continue;
    }

    unsupportedChanges.push({
      kind: 'PossibleColumnRename',
      tableName,
      columnName: droppedColumn.name,
      message:
        `Possible column rename detected in "${tableName}": ` +
        `"${droppedColumn.name}" -> "${renameCandidate.name}". ` +
        `Rename inference is not supported in generated migrations.`,
    });
  }
}

function getDependentViewNames(
  previousSnapshot: Snapshot,
  nextSnapshot: Snapshot,
  tableName: string,
): string[] {
  return [...new Set([
    ...previousSnapshot.dependencies
      .filter(edge => edge.kind === 'table_to_materialized_view' && edge.from === tableName)
      .map(edge => edge.to),
    ...nextSnapshot.dependencies
      .filter(edge => edge.kind === 'table_to_materialized_view' && edge.from === tableName)
      .map(edge => edge.to),
  ])].sort((left, right) => left.localeCompare(right));
}

function isSameTableEngine(left: SnapshotTable['engine'], right: SnapshotTable['engine']) {
  return left.type === right.type &&
    isSameStringArray(left.orderBy, right.orderBy) &&
    (left.partitionBy ?? null) === (right.partitionBy ?? null) &&
    isSameStringArray(left.primaryKey, right.primaryKey) &&
    (left.sampleBy ?? null) === (right.sampleBy ?? null);
}

function isSameSettings(left: SnapshotTable['settings'], right: SnapshotTable['settings']) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key] === value);
}

function isSameMaterializedView(left: SnapshotMaterializedView, right: SnapshotMaterializedView) {
  return left.name === right.name &&
    left.from === right.from &&
    (left.to ?? null) === (right.to ?? null) &&
    left.select === right.select;
}

function isSameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toNameMap<T extends { name: string }>(entries: T[]): Map<string, T> {
  return new Map(entries.map(entry => [entry.name, entry]));
}
