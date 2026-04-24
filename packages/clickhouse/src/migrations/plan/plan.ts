import type {
  AlterTableWithDependentViewsOperation,
  MigrationOperation,
  SnapshotDiffResult,
  TableMutationOperation,
} from '../diff/types.js';
import type { SnapshotTable } from '../snapshot/types.js';
import type {
  ClickHouseMigrationPlanContext,
  ClickHouseMigrationSyncSetting,
  ClickHouseTableCostStats,
  CreateMigrationPlanOptions,
  MigrationOperationClassification,
  MigrationOperationCostEstimate,
  MigrationPlan,
  MigrationPlanAnalyzer,
  MigrationPlanAnalyzerResult,
  MigrationPlanBlocker,
  MigrationPlanConfirmation,
  MigrationPlanDiagnostic,
  MigrationPlanInput,
  PlannedMigrationOperation,
} from './types.js';

/**
 * Converts a raw snapshot diff into an explicit migration plan.
 *
 * The initial planner is intentionally static: it classifies operations and
 * carries diagnostics/blockers without querying a live ClickHouse instance.
 * Later phases can enrich this plan with system-table cost estimates.
 */
export function createMigrationPlan(
  diff: SnapshotDiffResult,
  options: CreateMigrationPlanOptions = {},
): MigrationPlan {
  const plannedOperations = diff.operations.map((operation, operationIndex) =>
    planOperation(operation, operationIndex, diff, options),
  );
  const blockerDiagnostics = diff.unsupportedChanges.map(
    (change): MigrationPlanDiagnostic => ({
      level: 'error',
      kind: change.kind,
      message: change.message,
    }),
  );
  const warningDiagnostics = diff.warnings.map(
    (warning): MigrationPlanDiagnostic => ({
      level: 'warning',
      kind: warning.kind,
      message: warning.message,
    }),
  );
  const operationDiagnostics = plannedOperations.flatMap(operation => operation.diagnostics);
  const requiredConfirmations = plannedOperations.flatMap(operation => operation.requiredConfirmations);
  const recommendedSyncSettings = dedupeSyncSettings(
    plannedOperations.flatMap(operation => operation.recommendedSyncSettings),
  );
  const staticBlockers = plannedOperations.flatMap((operation, operationIndex): MigrationPlanBlocker[] =>
    operation.classification === 'forbidden'
      ? [{
          kind: 'ForbiddenOperation',
          operationIndex,
          message: forbiddenOperationMessage(operation.operation),
        }]
      : [],
  );
  const unsupportedBlockers: MigrationPlanBlocker[] = diff.unsupportedChanges.map(change => ({
    kind: change.kind,
    message: change.message,
    tableName: change.tableName,
    ...(change.columnName !== undefined ? { columnName: change.columnName } : {}),
  }));

  const plan: MigrationPlan = {
    previousSnapshot: diff.previousSnapshot,
    nextSnapshot: diff.nextSnapshot,
    sourceSnapshotHash: diff.previousSnapshot.contentHash,
    targetSnapshotHash: diff.nextSnapshot.contentHash,
    operations: plannedOperations,
    diagnostics: [
      ...blockerDiagnostics,
      ...warningDiagnostics,
      ...operationDiagnostics,
    ],
    blockers: [
      ...unsupportedBlockers,
      ...staticBlockers,
    ],
    requiredConfirmations,
    recommendedSyncSettings,
    // Backward-compatible alias. These settings are recommendations for the future executor,
    // not proof that generated SQL has applied them.
    requiredSyncSettings: recommendedSyncSettings,
  };

  const analyzerResult = runAnalyzers(plan, diff, options.analyzers ?? [], options.context);
  if (
    analyzerResult.diagnostics.length === 0 &&
    analyzerResult.blockers.length === 0 &&
    analyzerResult.confirmations.length === 0
  ) {
    return plan;
  }

  return {
    ...plan,
    diagnostics: [
      ...plan.diagnostics,
      ...analyzerResult.diagnostics,
    ],
    blockers: [
      ...plan.blockers,
      ...analyzerResult.blockers,
    ],
    requiredConfirmations: [
      ...plan.requiredConfirmations,
      ...analyzerResult.confirmations,
    ],
  };
}

export function isMigrationPlan(input: MigrationPlanInput): input is MigrationPlan {
  return 'blockers' in input &&
    'diagnostics' in input &&
    'requiredConfirmations' in input &&
    Array.isArray(input.operations) &&
    input.operations.every(operation => 'operation' in operation && 'classification' in operation);
}

function planOperation(
  operation: MigrationOperation,
  operationIndex: number,
  diff: SnapshotDiffResult,
  options: CreateMigrationPlanOptions,
): PlannedMigrationOperation {
  const classification = classifyOperation(operation, diff.previousSnapshot.tables);
  const costEstimate = estimateOperationCost(operation, options.context);
  const diagnostics = diagnosticsForOperation(
    operation,
    classification,
    operationIndex,
    costEstimate,
    options.context,
  );
  const requiredConfirmations = confirmationsForOperation(
    operation,
    classification,
    operationIndex,
    options,
  );

  return {
    operation,
    classification,
    costEstimate,
    diagnostics,
    requiredConfirmations,
    recommendedSyncSettings: syncSettingsForOperation(operation, classification),
    requiredSyncSettings: syncSettingsForOperation(operation, classification),
  };
}

function classifyOperation(
  operation: MigrationOperation,
  previousTables: SnapshotTable[],
): MigrationOperationClassification {
  switch (operation.kind) {
    case 'ModifyColumnType':
      return isKeyColumn(previousTables, operation.tableName, operation.columnName)
        ? 'forbidden'
        : 'mutation';
    case 'AlterTableWithDependentViews':
      return classifyAlterTableWithDependentViews(operation, previousTables);
    case 'DropColumn':
      return isKeyColumn(previousTables, operation.tableName, operation.columnName)
        ? 'forbidden'
        : 'metadata';
    case 'AddColumn':
    case 'CreateMaterializedView':
    case 'CreateTable':
    case 'DropMaterializedView':
    case 'DropTable':
    case 'ModifyColumnDefault':
    case 'RecreateMaterializedView':
      return 'metadata';
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

function classifyAlterTableWithDependentViews(
  operation: AlterTableWithDependentViewsOperation,
  previousTables: SnapshotTable[],
): MigrationOperationClassification {
  const nestedClassifications = operation.operations.map(nestedOperation =>
    classifyTableMutationOperation(nestedOperation, previousTables),
  );
  if (nestedClassifications.includes('forbidden')) {
    return 'forbidden';
  }

  if (nestedClassifications.includes('mutation')) {
    return 'mutation';
  }

  if (nestedClassifications.includes('data-copy')) {
    return 'data-copy';
  }

  return 'metadata';
}

function classifyTableMutationOperation(
  operation: TableMutationOperation,
  previousTables: SnapshotTable[],
): MigrationOperationClassification {
  if ((operation.kind === 'DropColumn' || operation.kind === 'ModifyColumnType') &&
    isKeyColumn(previousTables, operation.tableName, operation.columnName)
  ) {
    return 'forbidden';
  }

  return operation.kind === 'ModifyColumnType' ? 'mutation' : 'metadata';
}

function diagnosticsForOperation(
  operation: MigrationOperation,
  classification: MigrationOperationClassification,
  operationIndex: number,
  costEstimate: MigrationOperationCostEstimate,
  context?: ClickHouseMigrationPlanContext,
): MigrationPlanDiagnostic[] {
  const diagnostics: MigrationPlanDiagnostic[] = [];

  if (classification === 'mutation') {
    diagnostics.push({
      level: 'warning',
      kind: 'MutationOperation',
      operationIndex,
      message:
        `Operation "${operation.kind}" may trigger a ClickHouse mutation. ` +
        'Review table size and mutation impact before applying.',
    });
  }

  if (classification === 'forbidden') {
    diagnostics.push({
      level: 'error',
      kind: 'ForbiddenOperation',
      operationIndex,
      message: forbiddenOperationMessage(operation),
    });
  }

  if (operation.kind === 'DropTable') {
    diagnostics.push({
      level: 'warning',
      kind: 'DestructiveDropTable',
      operationIndex,
      message: `Operation drops table "${operation.tableName}".`,
    });
  }

  if (operation.kind === 'DropColumn') {
    diagnostics.push({
      level: 'warning',
      kind: 'DestructiveDropColumn',
      operationIndex,
      message: `Operation drops column "${operation.tableName}.${operation.columnName}".`,
    });
  }

  diagnostics.push(...costDiagnosticsForOperation(
    operation,
    classification,
    operationIndex,
    costEstimate,
    context,
  ));

  return diagnostics;
}

function confirmationsForOperation(
  operation: MigrationOperation,
  classification: MigrationOperationClassification,
  operationIndex: number,
  options: CreateMigrationPlanOptions,
): MigrationPlanConfirmation[] {
  if (classification !== 'mutation' || options.requireConfirmationForMutations === false) {
    return [];
  }

  return [
    {
      kind: 'MutationRequiresConfirmation',
      operationIndex,
      message:
        `Operation "${operation.kind}" is classified as a mutation and should require explicit confirmation.`,
    },
  ];
}

function syncSettingsForOperation(
  operation: MigrationOperation,
  classification: MigrationOperationClassification,
): ClickHouseMigrationSyncSetting[] {
  if (classification === 'forbidden') {
    return [];
  }

  const settings: ClickHouseMigrationSyncSetting[] = [];
  if (operation.kind !== 'CreateTable' && operation.kind !== 'CreateMaterializedView') {
    settings.push({
      name: 'alter_sync',
      value: 2,
      reason: 'Wait for ClickHouse ALTER/DDL operations to finish on active replicas where supported.',
    });
  }

  if (classification === 'mutation') {
    settings.push({
      name: 'mutations_sync',
      value: 2,
      reason: 'Wait for mutation-triggering ALTER operations to finish before marking the step complete.',
    });
  }

  return settings;
}

function dedupeSyncSettings(settings: ClickHouseMigrationSyncSetting[]): ClickHouseMigrationSyncSetting[] {
  const seen = new Set<string>();
  const deduped: ClickHouseMigrationSyncSetting[] = [];

  for (const setting of settings) {
    const key = `${setting.name}:${setting.value}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(setting);
  }

  return deduped;
}

function runAnalyzers(
  plan: MigrationPlan,
  diff: SnapshotDiffResult,
  analyzers: MigrationPlanAnalyzer[],
  context?: ClickHouseMigrationPlanContext,
): Required<MigrationPlanAnalyzerResult> {
  const results = analyzers.map((analyzer, index): MigrationPlanAnalyzerResult => {
    try {
      return analyzer(plan, { diff, clickhouse: context });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        diagnostics: [{
          level: 'error',
          kind: 'AnalyzerError',
          message: `Analyzer at index ${index} failed: ${message}`,
        }],
        blockers: [{
          kind: 'AnalyzerError',
          message: `Analyzer at index ${index} failed: ${message}`,
        }],
      };
    }
  });

  return {
    diagnostics: results.flatMap(result => result.diagnostics ?? []),
    blockers: results.flatMap(result => result.blockers ?? []),
    confirmations: results.flatMap(result => result.confirmations ?? []),
  };
}

function estimateOperationCost(
  operation: MigrationOperation,
  context?: ClickHouseMigrationPlanContext,
): MigrationOperationCostEstimate {
  const tableName = getOperationTableName(operation);
  if (!tableName) {
    return {
      source: 'static',
      confidence: 'none',
    };
  }

  const stats = getTableStats(context, tableName);
  if (!stats) {
    return {
      tableName,
      source: 'static',
      confidence: 'none',
    };
  }

  return {
    tableName,
    affectedRows: stats.totalRows,
    affectedBytes: stats.totalBytes,
    activeParts: stats.activeParts,
    pendingMutations: stats.pendingMutations,
    replicaAbsoluteDelaySeconds: stats.replicaAbsoluteDelaySeconds,
    replicaQueueSize: stats.replicaQueueSize,
    source: 'provided-context',
    confidence: 'medium',
  };
}

function costDiagnosticsForOperation(
  operation: MigrationOperation,
  classification: MigrationOperationClassification,
  operationIndex: number,
  costEstimate: MigrationOperationCostEstimate,
  context?: ClickHouseMigrationPlanContext,
): MigrationPlanDiagnostic[] {
  if (costEstimate.source !== 'provided-context') {
    return [];
  }

  const diagnostics: MigrationPlanDiagnostic[] = [];
  const mutationWarningBytes = atLeast(context?.mutationWarningBytes, 0, 1024 ** 3);
  const mutationWarningRows = atLeast(context?.mutationWarningRows, 1, 100_000_000);
  const activePartsWarningThreshold = atLeast(context?.activePartsWarningThreshold, 1, 200);
  const pendingMutationsWarningThreshold = atLeast(context?.pendingMutationsWarningThreshold, 0, 0);
  const replicaDelayWarningSeconds = atLeast(context?.replicaDelayWarningSeconds, 0, 60);

  if (classification === 'mutation' &&
    costEstimate.affectedBytes !== undefined &&
    costEstimate.affectedBytes >= mutationWarningBytes
  ) {
    diagnostics.push({
      level: 'warning',
      kind: 'ExpensiveMutationBytes',
      operationIndex,
      message:
        `Operation "${operation.kind}" may mutate ${costEstimate.affectedBytes} bytes ` +
        `on table "${costEstimate.tableName}".`,
    });
  }

  if (classification === 'mutation' &&
    costEstimate.affectedRows !== undefined &&
    costEstimate.affectedRows >= mutationWarningRows
  ) {
    diagnostics.push({
      level: 'warning',
      kind: 'ExpensiveMutationRows',
      operationIndex,
      message:
        `Operation "${operation.kind}" may mutate ${costEstimate.affectedRows} rows ` +
        `on table "${costEstimate.tableName}".`,
    });
  }

  if (costEstimate.activeParts !== undefined && costEstimate.activeParts >= activePartsWarningThreshold) {
    diagnostics.push({
      level: 'warning',
      kind: 'HighActivePartCount',
      operationIndex,
      message:
        `Table "${costEstimate.tableName}" has ${costEstimate.activeParts} active parts. ` +
        'Consider reducing part pressure before applying DDL.',
    });
  }

  if (costEstimate.pendingMutations !== undefined &&
    costEstimate.pendingMutations > pendingMutationsWarningThreshold
  ) {
    diagnostics.push({
      level: 'warning',
      kind: 'PendingMutations',
      operationIndex,
      message:
        `Table "${costEstimate.tableName}" has ${costEstimate.pendingMutations} pending mutation(s).`,
    });
  }

  if (costEstimate.replicaAbsoluteDelaySeconds !== undefined &&
    costEstimate.replicaAbsoluteDelaySeconds >= replicaDelayWarningSeconds
  ) {
    diagnostics.push({
      level: 'warning',
      kind: 'ReplicaDelay',
      operationIndex,
      message:
        `Table "${costEstimate.tableName}" has replica delay of ` +
        `${costEstimate.replicaAbsoluteDelaySeconds} second(s).`,
    });
  }

  return diagnostics;
}

function forbiddenOperationMessage(operation: MigrationOperation): string {
  if (operation.kind === 'DropColumn' || operation.kind === 'ModifyColumnType') {
    return [
      `Cannot ${operation.kind === 'DropColumn' ? 'drop' : 'modify'} key column ` +
        `"${operation.tableName}.${operation.columnName}" automatically.`,
      'ClickHouse key columns participate in ORDER BY, PRIMARY KEY, PARTITION BY, or SAMPLE BY expressions.',
      'Recommended approach: create a new table with the desired schema, backfill data in controlled batches, swap tables, then drop the old table.',
      'Use a custom SQL migration if you understand the operational risk.',
    ].join(' ');
  }

  return [
    `Operation "${operation.kind}" cannot be generated safely.`,
    'Use a custom SQL migration or split the schema evolution into supported steps.',
  ].join(' ');
}

function atLeast(value: number | undefined, minimum: number, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(minimum, value);
}

function getOperationTableName(operation: MigrationOperation): string | undefined {
  switch (operation.kind) {
    case 'AddColumn':
    case 'AlterTableWithDependentViews':
    case 'DropColumn':
    case 'DropTable':
    case 'ModifyColumnDefault':
    case 'ModifyColumnType':
      return operation.tableName;
    case 'CreateTable':
      return operation.table.name;
    case 'CreateMaterializedView':
    case 'DropMaterializedView':
    case 'RecreateMaterializedView':
      return undefined;
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

function getTableStats(
  context: ClickHouseMigrationPlanContext | undefined,
  tableName: string,
): ClickHouseTableCostStats | undefined {
  if (!context?.tables) {
    return undefined;
  }

  if (Array.isArray(context.tables)) {
    return context.tables.find(table => table.tableName === tableName);
  }

  return context.tables[tableName];
}

function isKeyColumn(tables: SnapshotTable[], tableName: string, columnName: string): boolean {
  const table = tables.find(candidate => candidate.name === tableName);
  if (!table) {
    return false;
  }

  return [
    ...table.engine.orderBy,
    ...table.engine.primaryKey,
    table.engine.partitionBy,
    table.engine.sampleBy,
  ].some(expression => expression !== undefined && expressionReferencesColumn(expression, columnName));
}

function expressionReferencesColumn(expression: string, columnName: string): boolean {
  if (expression === columnName) {
    return true;
  }

  const escapedColumn = columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escapedColumn}([^A-Za-z0-9_]|$)`).test(expression);
}
