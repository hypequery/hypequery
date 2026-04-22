export interface Snapshot {
  version: 1;
  dialect: 'clickhouse';
  tables: SnapshotTable[];
  materializedViews: SnapshotMaterializedView[];
  dependencies: SnapshotDependencyEdge[];
  contentHash: string;
}

export interface SnapshotTable {
  name: string;
  columns: SnapshotColumn[];
  engine: SnapshotTableEngine;
  settings: Record<string, string>;
}

export interface SnapshotColumn {
  name: string;
  type: string;
  default?: string;
}

export interface SnapshotTableEngine {
  type: string;
  orderBy: string[];
  partitionBy?: string;
  primaryKey: string[];
  sampleBy?: string;
}

export interface SnapshotMaterializedView {
  name: string;
  from: string;
  to?: string;
  select: string;
}

export interface SnapshotDependencyEdge {
  from: string;
  to: string;
  kind: 'table_to_materialized_view';
}
