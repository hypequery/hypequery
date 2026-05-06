import type { MigrationOperation, SnapshotDiffResult } from '../diff/types.js';
import type {
  MigrationOperationClassification,
  MigrationPlan,
  MigrationPlanInput,
} from '../plan/types.js';
import type { Snapshot, SnapshotMaterializedView } from '../snapshot/types.js';

export interface MigrationMeta {
  name: string;
  timestamp: string;
  operations: Array<{
    kind: MigrationOperation['kind'];
    classification: MigrationOperationClassification;
  }>;
  sourceSnapshotHash: string;
  targetSnapshotHash: string;
  custom: boolean;
  unsafe: boolean;
  containsManualSteps: boolean;
}

export interface RenderMigrationArtifactsOptions {
  name: string;
  timestamp: string;
  cluster?: string;
}

export interface RenderMigrationArtifactsResult {
  upSql: string;
  downSql: string;
  meta: MigrationMeta;
  plan: MigrationPlan;
}

export interface RenderSqlContext {
  plan: MigrationPlan;
  cluster?: string;
}

export interface MaterializedViewRenderContext {
  view: SnapshotMaterializedView;
  cluster?: string;
}

export interface WriteMigrationArtifactsOptions {
  outDir: string;
  migrationName: string;
  artifacts: RenderMigrationArtifactsResult;
}

export interface WriteMigrationArtifactsResult {
  migrationDir: string;
  upPath: string;
  downPath: string;
  metaPath: string;
  planPath: string;
}

export interface SnapshotLookup {
  previousSnapshot: Snapshot;
  nextSnapshot: Snapshot;
}

export type RenderMigrationArtifactsInput = MigrationPlanInput | SnapshotDiffResult;
