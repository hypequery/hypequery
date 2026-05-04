import type { MigrationOperation, SnapshotDiffResult } from '../diff/types.js';
import type { Snapshot } from '../snapshot/types.js';

export type MigrationOperationClassification =
  | 'metadata'
  | 'mutation'
  | 'data-copy'
  | 'forbidden';

export type MigrationPlanDiagnosticLevel = 'warning' | 'error';

export interface MigrationPlanDiagnostic {
  level: MigrationPlanDiagnosticLevel;
  kind: string;
  message: string;
  operationIndex?: number;
}

export interface MigrationPlanBlocker {
  kind: string;
  message: string;
  tableName?: string;
  columnName?: string;
  operationIndex?: number;
}

export interface MigrationPlanConfirmation {
  kind: string;
  message: string;
  operationIndex: number;
}

export interface ClickHouseMigrationSyncSetting {
  name: 'alter_sync' | 'mutations_sync' | 'replication_alter_partitions_sync' | 'distributed_ddl_task_timeout';
  value: string | number;
  reason: string;
}

export interface ClickHouseTableCostStats {
  tableName: string;
  totalRows?: number;
  totalBytes?: number;
  activeParts?: number;
  pendingMutations?: number;
  replicaAbsoluteDelaySeconds?: number;
  replicaQueueSize?: number;
}

export interface ClickHouseMigrationPlanContext {
  tables?: Record<string, ClickHouseTableCostStats> | ClickHouseTableCostStats[];
  mutationWarningBytes?: number;
  mutationWarningRows?: number;
  activePartsWarningThreshold?: number;
  pendingMutationsWarningThreshold?: number;
  replicaDelayWarningSeconds?: number;
}

export interface MigrationOperationCostEstimate {
  tableName?: string;
  affectedRows?: number;
  affectedBytes?: number;
  activeParts?: number;
  pendingMutations?: number;
  replicaAbsoluteDelaySeconds?: number;
  replicaQueueSize?: number;
  source: 'static' | 'provided-context';
  confidence: 'none' | 'low' | 'medium';
}

export interface PlannedMigrationOperation {
  operation: MigrationOperation;
  classification: MigrationOperationClassification;
  costEstimate: MigrationOperationCostEstimate;
  diagnostics: MigrationPlanDiagnostic[];
  requiredConfirmations: MigrationPlanConfirmation[];
  recommendedSyncSettings: ClickHouseMigrationSyncSetting[];
  requiredSyncSettings: ClickHouseMigrationSyncSetting[];
}

export interface MigrationPlan {
  previousSnapshot: Snapshot;
  nextSnapshot: Snapshot;
  sourceSnapshotHash: string;
  targetSnapshotHash: string;
  operations: PlannedMigrationOperation[];
  diagnostics: MigrationPlanDiagnostic[];
  blockers: MigrationPlanBlocker[];
  requiredConfirmations: MigrationPlanConfirmation[];
  recommendedSyncSettings: ClickHouseMigrationSyncSetting[];
  requiredSyncSettings: ClickHouseMigrationSyncSetting[];
}

export interface MigrationPlanAnalyzerContext {
  diff: SnapshotDiffResult;
  clickhouse?: ClickHouseMigrationPlanContext;
}

export interface MigrationPlanAnalyzerResult {
  diagnostics?: MigrationPlanDiagnostic[];
  blockers?: MigrationPlanBlocker[];
  confirmations?: MigrationPlanConfirmation[];
}

export type MigrationPlanAnalyzer = (
  plan: MigrationPlan,
  context: MigrationPlanAnalyzerContext,
) => MigrationPlanAnalyzerResult;

export interface CreateMigrationPlanOptions {
  requireConfirmationForMutations?: boolean;
  analyzers?: MigrationPlanAnalyzer[];
  context?: ClickHouseMigrationPlanContext;
}

export type MigrationPlanInput = SnapshotDiffResult | MigrationPlan;
