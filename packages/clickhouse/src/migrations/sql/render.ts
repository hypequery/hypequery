import type {
  AlterTableWithDependentViewsOperation,
  MigrationOperation,
} from '../diff/types.js';
import { createMigrationPlan, isMigrationPlan } from '../plan/index.js';
import type {
  Snapshot,
  SnapshotColumn,
  SnapshotColumnDefault,
  SnapshotMaterializedView,
  SnapshotTable,
} from '../snapshot/types.js';
import type {
  MaterializedViewRenderContext,
  RenderMigrationArtifactsInput,
  RenderMigrationArtifactsOptions,
  RenderMigrationArtifactsResult,
  RenderSqlContext,
  SnapshotLookup,
} from './types.js';

/**
 * Renders a snapshot diff into reviewable migration artifacts.
 *
 * The renderer produces forward SQL, best-effort reverse SQL, and metadata. It
 * also sequences dependent materialized views around table mutations so stored
 * view SELECT definitions are dropped and recreated with the target snapshot.
 */
export function renderMigrationArtifacts(
  input: RenderMigrationArtifactsInput,
  options: RenderMigrationArtifactsOptions,
): RenderMigrationArtifactsResult {
  const plan = isMigrationPlan(input) ? input : createMigrationPlan(input);
  assertNoPlanBlockers(plan);
  const upStatements: string[] = [];
  const downStatements: string[] = [];
  const consumedViewNames = new Set<string>();
  const renderedOperations: Array<{
    kind: MigrationOperation['kind'];
    classification: typeof plan.operations[number]['classification'];
  }> = [];
  let containsManualSteps = false;

  for (const plannedOperation of normalizeOperationsForRendering(plan.operations)) {
    const { operation } = plannedOperation;
    if (isMaterializedViewOperation(operation) && consumedViewNames.has(getOperationViewName(operation))) {
      continue;
    }

    renderedOperations.push({
      kind: operation.kind,
      classification: plannedOperation.classification,
    });
    upStatements.push(...renderOperationUp(operation, { plan, cluster: options.cluster }, consumedViewNames));

    const renderedDown = renderOperationDown(operation, {
      previousSnapshot: plan.previousSnapshot,
      nextSnapshot: plan.nextSnapshot,
      cluster: options.cluster,
    }, consumedViewNames);
    downStatements.unshift(...renderedDown.statements);
    containsManualSteps = containsManualSteps || renderedDown.manual;
  }

  return {
    upSql: joinStatements(upStatements),
    downSql: joinStatements(downStatements),
    meta: {
      name: options.name,
      timestamp: options.timestamp,
      operations: renderedOperations,
      sourceSnapshotHash: plan.sourceSnapshotHash,
      targetSnapshotHash: plan.targetSnapshotHash,
      custom: false,
      unsafe: plan.diagnostics.some(diagnostic => diagnostic.level === 'warning') ||
        plan.blockers.length > 0 ||
        containsManualSteps,
      containsManualSteps,
    },
    plan,
  };
}

function renderOperationUp(
  operation: MigrationOperation,
  context: RenderSqlContext,
  consumedViewNames: Set<string>,
): string[] {
  switch (operation.kind) {
    case 'CreateTable':
      return [renderCreateTable(operation.table, context.cluster)];
    case 'DropTable':
      return [renderDropTable(operation.tableName, context.cluster)];
    case 'AddColumn':
      return [renderAlterTableAddColumn(operation.tableName, operation.column, context.cluster)];
    case 'DropColumn':
      return [renderAlterTableDropColumn(operation.tableName, operation.columnName, context.cluster)];
    case 'ModifyColumnDefault':
    case 'ModifyColumnType': {
      const nextColumn = requireColumn(context.plan.nextSnapshot, operation.tableName, operation.columnName);
      return [renderAlterTableModifyColumn(operation.tableName, nextColumn, context.cluster)];
    }
    case 'CreateMaterializedView':
      return [renderCreateMaterializedView({ view: operation.view, cluster: context.cluster })];
    case 'DropMaterializedView':
      return [renderDropMaterializedView(operation.viewName, context.cluster)];
    case 'RecreateMaterializedView':
      return [
        renderDropMaterializedView(operation.previousView.name, context.cluster),
        renderCreateMaterializedView({ view: operation.nextView, cluster: context.cluster }),
      ];
    case 'AlterTableWithDependentViews':
      return renderAlterTableWithDependentViewsUp(operation, context, consumedViewNames);
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

function renderOperationDown(
  operation: MigrationOperation,
  lookup: SnapshotLookup & { cluster?: string },
  consumedViewNames: Set<string>,
): { statements: string[]; manual: boolean } {
  switch (operation.kind) {
    case 'CreateTable':
      return { statements: [renderDropTable(operation.table.name, lookup.cluster)], manual: false };
    case 'DropTable':
      return { statements: [manualDownComment(`recreate dropped table "${operation.tableName}" manually`)], manual: true };
    case 'AddColumn':
      return {
        statements: [renderAlterTableDropColumn(operation.tableName, operation.column.name, lookup.cluster)],
        manual: false,
      };
    case 'DropColumn':
      return {
        statements: [manualDownComment(`recreate dropped column "${operation.tableName}.${operation.columnName}" manually`)],
        manual: true,
      };
    case 'ModifyColumnDefault': {
      const previousColumn = requireColumn(lookup.previousSnapshot, operation.tableName, operation.columnName);
      return {
        statements: [renderAlterTableModifyColumn(operation.tableName, previousColumn, lookup.cluster)],
        manual: false,
      };
    }
    case 'ModifyColumnType':
      return {
        statements: [manualDownComment(`revert type change for "${operation.tableName}.${operation.columnName}" manually`)],
        manual: true,
      };
    case 'CreateMaterializedView':
      return { statements: [renderDropMaterializedView(operation.view.name, lookup.cluster)], manual: false };
    case 'DropMaterializedView': {
      const previousView = requireMaterializedView(lookup.previousSnapshot, operation.viewName);
      return {
        statements: [renderCreateMaterializedView({ view: previousView, cluster: lookup.cluster })],
        manual: false,
      };
    }
    case 'RecreateMaterializedView':
      return {
        statements: [
          renderDropMaterializedView(operation.nextView.name, lookup.cluster),
          renderCreateMaterializedView({ view: operation.previousView, cluster: lookup.cluster }),
        ],
        manual: false,
      };
    case 'AlterTableWithDependentViews':
      return renderAlterTableWithDependentViewsDown(operation, lookup, consumedViewNames);
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

function renderAlterTableWithDependentViewsUp(
  operation: AlterTableWithDependentViewsOperation,
  context: RenderSqlContext,
  consumedViewNames: Set<string>,
): string[] {
  const statements: string[] = [];

  for (const viewName of operation.dependentViewNames) {
    statements.push(renderDropMaterializedView(viewName, context.cluster));
    consumedViewNames.add(viewName);
  }

  for (const nestedOperation of normalizeTableMutationOperations(operation.operations)) {
    statements.push(...renderOperationUp(nestedOperation, context, consumedViewNames));
  }

  for (const viewName of operation.dependentViewNames) {
    statements.push(
      renderCreateMaterializedView({
        view: requireMaterializedView(context.plan.nextSnapshot, viewName),
        cluster: context.cluster,
      }),
    );
  }

  return statements;
}

function renderAlterTableWithDependentViewsDown(
  operation: AlterTableWithDependentViewsOperation,
  lookup: SnapshotLookup & { cluster?: string },
  consumedViewNames: Set<string>,
): { statements: string[]; manual: boolean } {
  const statements: string[] = [];
  let manual = false;

  for (const viewName of operation.dependentViewNames) {
    statements.push(renderDropMaterializedView(viewName, lookup.cluster));
    consumedViewNames.add(viewName);
  }

  for (const nestedOperation of [...normalizeTableMutationOperations(operation.operations)].reverse()) {
    const rendered = renderOperationDown(nestedOperation, lookup, consumedViewNames);
    statements.push(...rendered.statements);
    manual = manual || rendered.manual;
  }

  for (const viewName of operation.dependentViewNames) {
    statements.push(
      renderCreateMaterializedView({
        view: requireMaterializedView(lookup.previousSnapshot, viewName),
        cluster: lookup.cluster,
      }),
    );
  }

  return { statements, manual };
}

function renderCreateTable(table: SnapshotTable, cluster?: string): string {
  const columns = table.columns
    .map(column => `  ${quoteIdentifier(column.name)} ${column.type}${renderColumnDefault(column)}`)
    .join(',\n');
  const settings = Object.keys(table.settings).length > 0
    ? `\nSETTINGS ${Object.entries(table.settings).map(([key, value]) => `${key} = ${value}`).join(', ')}`
    : '';

  return [
    `CREATE TABLE ${quoteIdentifier(table.name)}${renderClusterClause(cluster)} (`,
    columns,
    `) ENGINE = ${renderTableEngine(table)}${settings};`,
  ].join('\n');
}

function renderDropTable(tableName: string, cluster?: string): string {
  return `DROP TABLE ${quoteIdentifier(tableName)}${renderClusterClause(cluster)};`;
}

function renderAlterTableAddColumn(tableName: string, column: SnapshotColumn, cluster?: string): string {
  return `ALTER TABLE ${quoteIdentifier(tableName)}${renderClusterClause(cluster)} ADD COLUMN ` +
    `${quoteIdentifier(column.name)} ${column.type}${renderColumnDefault(column)};`;
}

function renderAlterTableDropColumn(tableName: string, columnName: string, cluster?: string): string {
  return `ALTER TABLE ${quoteIdentifier(tableName)}${renderClusterClause(cluster)} DROP COLUMN ${quoteIdentifier(columnName)};`;
}

function renderAlterTableModifyColumn(tableName: string, column: SnapshotColumn, cluster?: string): string {
  return `ALTER TABLE ${quoteIdentifier(tableName)}${renderClusterClause(cluster)} MODIFY COLUMN ` +
    `${quoteIdentifier(column.name)} ${column.type}${renderColumnDefault(column)};`;
}

function renderCreateMaterializedView(context: MaterializedViewRenderContext): string {
  const toClause = context.view.to ? `\nTO ${quoteIdentifier(context.view.to)}` : '';
  return [
    `CREATE MATERIALIZED VIEW ${quoteIdentifier(context.view.name)}${renderClusterClause(context.cluster)}${toClause} AS`,
    context.view.select,
    ';',
  ].join('\n');
}

function renderDropMaterializedView(viewName: string, cluster?: string): string {
  return `DROP TABLE ${quoteIdentifier(viewName)}${renderClusterClause(cluster)};`;
}

function renderTableEngine(table: SnapshotTable): string {
  const parts = [table.engine.type, `ORDER BY (${table.engine.orderBy.join(', ')})`];

  if (table.engine.partitionBy) {
    parts.push(`PARTITION BY ${table.engine.partitionBy}`);
  }

  if (table.engine.primaryKey.length > 0) {
    parts.push(`PRIMARY KEY (${table.engine.primaryKey.join(', ')})`);
  }

  if (table.engine.sampleBy) {
    parts.push(`SAMPLE BY ${table.engine.sampleBy}`);
  }

  return parts.join('\n');
}

function renderColumnDefault(column: SnapshotColumn): string {
  return column.default !== undefined ? ` DEFAULT ${renderDefaultValue(column.default)}` : '';
}

function renderClusterClause(cluster?: string): string {
  return cluster ? ` ON CLUSTER ${quoteIdentifier(cluster)}` : '';
}

function quoteIdentifier(identifier: string): string {
  if (identifier.trim() === '') {
    throw new Error('Invalid ClickHouse identifier: identifiers must not be empty.');
  }

  return `\`${identifier.replace(/`/g, '``')}\``;
}

function requireColumn(snapshot: Snapshot, tableName: string, columnName: string): SnapshotColumn {
  const table = snapshot.tables.find(candidate => candidate.name === tableName);
  if (!table) {
    throw new Error(`Table "${tableName}" not found in snapshot.`);
  }

  const column = table.columns.find(candidate => candidate.name === columnName);
  if (!column) {
    throw new Error(`Column "${tableName}.${columnName}" not found in snapshot.`);
  }

  return column;
}

function requireMaterializedView(snapshot: Snapshot, viewName: string): SnapshotMaterializedView {
  const view = snapshot.materializedViews.find(candidate => candidate.name === viewName);
  if (!view) {
    throw new Error(`Materialized view "${viewName}" not found in snapshot.`);
  }

  return view;
}

function isMaterializedViewOperation(
  operation: MigrationOperation,
): operation is Extract<MigrationOperation, { kind: 'DropMaterializedView' | 'CreateMaterializedView' | 'RecreateMaterializedView' }> {
  return operation.kind === 'DropMaterializedView' ||
    operation.kind === 'CreateMaterializedView' ||
    operation.kind === 'RecreateMaterializedView';
}

function getOperationViewName(
  operation: Extract<MigrationOperation, { kind: 'DropMaterializedView' | 'CreateMaterializedView' | 'RecreateMaterializedView' }>,
): string {
  switch (operation.kind) {
    case 'DropMaterializedView':
      return operation.viewName;
    case 'CreateMaterializedView':
      return operation.view.name;
    case 'RecreateMaterializedView':
      return operation.nextView.name;
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

function manualDownComment(message: string): string {
  return `-- MANUAL STEP REQUIRED: ${message}`;
}

function joinStatements(statements: string[]): string {
  return statements.join('\n\n').trim();
}

function renderDefaultValue(defaultValue: SnapshotColumnDefault): string {
  if (defaultValue.kind === 'sql') {
    return defaultValue.value;
  }

  if (defaultValue.value === null) {
    return 'NULL';
  }

  if (typeof defaultValue.value === 'number') {
    return String(defaultValue.value);
  }

  if (typeof defaultValue.value === 'boolean') {
    return defaultValue.value ? 'true' : 'false';
  }

  return `'${escapeStringLiteral(defaultValue.value)}'`;
}

function escapeStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\0')
    .replace(/\x08/g, '\\b')
    .replace(/\f/g, '\\f')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\v/g, '\\v')
    .replace(/'/g, "\\'");
}

function normalizeOperationsForRendering(
  operations: RenderMigrationArtifactsResult['plan']['operations'],
) {
  return operations.map(plannedOperation => {
    if (plannedOperation.operation.kind !== 'AlterTableWithDependentViews') {
      return plannedOperation;
    }

    return {
      ...plannedOperation,
      operation: {
        ...plannedOperation.operation,
        operations: normalizeTableMutationOperations(plannedOperation.operation.operations),
      },
    };
  }).filter(plannedOperation => {
    if (plannedOperation.operation.kind !== 'ModifyColumnDefault') {
      return true;
    }

    const operation = plannedOperation.operation;
    return !operations.some(candidate =>
      candidate.operation.kind === 'ModifyColumnType' &&
      candidate.operation.tableName === operation.tableName &&
      candidate.operation.columnName === operation.columnName,
    );
  });
}

function normalizeTableMutationOperations(operations: AlterTableWithDependentViewsOperation['operations']) {
  return operations.filter(operation => {
    if (operation.kind !== 'ModifyColumnDefault') {
      return true;
    }

    return !operations.some(candidate =>
      candidate.kind === 'ModifyColumnType' &&
      candidate.tableName === operation.tableName &&
      candidate.columnName === operation.columnName,
    );
  });
}

function assertNoPlanBlockers(plan: RenderMigrationArtifactsResult['plan']) {
  if (plan.blockers.length === 0) {
    return;
  }

  throw new Error(
    'Cannot render migration with unsupported changes:\n' +
    plan.blockers.map(blocker => `- ${blocker.message}`).join('\n') +
    '\n\nUse a custom SQL migration for this change, or split the schema evolution into supported steps.',
  );
}
