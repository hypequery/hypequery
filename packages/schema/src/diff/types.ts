import type {
  Snapshot,
  SnapshotColumn,
  SnapshotColumnDefault,
  SnapshotMaterializedView,
  SnapshotTable,
} from '../snapshot/types.js';

export interface CreateTableOperation {
  kind: 'CreateTable';
  table: SnapshotTable;
}

export interface DropTableOperation {
  kind: 'DropTable';
  tableName: string;
}

export interface AddColumnOperation {
  kind: 'AddColumn';
  tableName: string;
  column: SnapshotColumn;
}

export interface DropColumnOperation {
  kind: 'DropColumn';
  tableName: string;
  columnName: string;
}

export interface ModifyColumnDefaultOperation {
  kind: 'ModifyColumnDefault';
  tableName: string;
  columnName: string;
  previousDefault?: SnapshotColumnDefault;
  nextDefault?: SnapshotColumnDefault;
}

export interface ModifyColumnTypeOperation {
  kind: 'ModifyColumnType';
  tableName: string;
  columnName: string;
  previousType: string;
  nextType: string;
}

export interface CreateMaterializedViewOperation {
  kind: 'CreateMaterializedView';
  view: SnapshotMaterializedView;
}

export interface DropMaterializedViewOperation {
  kind: 'DropMaterializedView';
  viewName: string;
}

export interface RecreateMaterializedViewOperation {
  kind: 'RecreateMaterializedView';
  previousView: SnapshotMaterializedView;
  nextView: SnapshotMaterializedView;
}

export type TableMutationOperation =
  | AddColumnOperation
  | DropColumnOperation
  | ModifyColumnDefaultOperation
  | ModifyColumnTypeOperation;

export interface AlterTableWithDependentViewsOperation {
  kind: 'AlterTableWithDependentViews';
  tableName: string;
  dependentViewNames: string[];
  operations: TableMutationOperation[];
}

export type MigrationOperation =
  | AlterTableWithDependentViewsOperation
  | CreateMaterializedViewOperation
  | CreateTableOperation
  | DropMaterializedViewOperation
  | DropTableOperation
  | RecreateMaterializedViewOperation
  | TableMutationOperation;

export interface DiffWarning {
  kind: 'ModifyColumnTypeRequiresConfirmation';
  tableName: string;
  columnName: string;
  message: string;
}

export interface UnsupportedChange {
  kind:
    | 'PossibleColumnRename'
    | 'TableEngineChanged'
    | 'TableSettingsChanged';
  message: string;
  tableName: string;
  columnName?: string;
}

export interface SnapshotDiffResult {
  previousSnapshot: Snapshot;
  nextSnapshot: Snapshot;
  operations: MigrationOperation[];
  warnings: DiffWarning[];
  unsupportedChanges: UnsupportedChange[];
}
