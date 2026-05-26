import type {
  CheckDatasetsAgainstSchemaInput,
  CompatibilityDatasetInstance,
  CompatibilityDimensionDefinition,
  CompatibilityMeasureDefinition,
  CompatibilityMetricFilter,
  CompatibilityRelationshipTarget,
  DatasetSchemaCompatibilityDiagnostic,
  DatasetSchemaCompatibilityReport,
  SemanticCompatibilityPlanOptions,
} from './types.js';
import type {
  Snapshot,
  SnapshotColumn,
  SnapshotMaterializedView,
  SnapshotTable,
} from '../snapshot/index.js';
import type { MigrationPlanAnalyzer, MigrationPlanAnalyzerResult } from '../plan/index.js';

function createDiagnostic(
  diagnostic: DatasetSchemaCompatibilityDiagnostic,
): DatasetSchemaCompatibilityDiagnostic {
  return diagnostic;
}

function isNumericClickHouseType(type: string): boolean {
  return /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|Decimal(?:32|64|128|256)?(?:\(|$))/.test(type);
}

function findSnapshotTable(snapshot: Snapshot, name: string): SnapshotTable | undefined {
  return snapshot.tables.find(table => table.name === name);
}

function findSnapshotMaterializedView(snapshot: Snapshot, name: string): SnapshotMaterializedView | undefined {
  return snapshot.materializedViews.find(view => view.name === name);
}

function resolveSourceTable(
  snapshot: Snapshot,
  sourceName: string,
): SnapshotTable | undefined {
  const table = findSnapshotTable(snapshot, sourceName);
  if (table) {
    return table;
  }

  const view = findSnapshotMaterializedView(snapshot, sourceName);
  if (!view?.to) {
    return undefined;
  }

  return findSnapshotTable(snapshot, view.to);
}

function hasSnapshotSource(snapshot: Snapshot, sourceName: string): boolean {
  return findSnapshotTable(snapshot, sourceName) != null || findSnapshotMaterializedView(snapshot, sourceName) != null;
}

function findSnapshotColumn(table: SnapshotTable, columnName: string): SnapshotColumn | undefined {
  return table.columns.find(column => column.name === columnName);
}

function extractSimpleSqlColumn(sql: string): string | undefined {
  const identifier = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*|` + '`[^`]+`' + String.raw`|"[^"]+")`;
  const pattern = new RegExp(String.raw`^\s*(${identifier})(?:\.(${identifier}))?\s*$`);
  const match = pattern.exec(sql);
  if (!match) {
    return undefined;
  }

  const rawIdentifier = match[2] ?? match[1];
  return rawIdentifier.replace(/^`(.*)`$/, '$1').replace(/^"(.*)"$/, '$1');
}

function createSqlExpressionLimitationDiagnostic(
  ds: CompatibilityDatasetInstance,
  fieldName: string,
  expressionKind: 'dimension' | 'measure',
): DatasetSchemaCompatibilityDiagnostic {
  return createDiagnostic({
    level: 'warning',
    code: 'LimitedSqlExpressionCompatibility',
    datasetName: ds.name,
    fieldName,
    sourceName: ds.source,
    message: `Schema compatibility for SQL-backed ${expressionKind} "${fieldName}" is limited; complex SQL lineage is not fully analyzed.`,
  });
}

function resolveDimensionPhysicalColumn(
  dimensionName: string,
  definition: CompatibilityDimensionDefinition | undefined,
): string | undefined {
  if (!definition) {
    return dimensionName;
  }

  if (definition.sql) {
    return extractSimpleSqlColumn(definition.sql);
  }

  return definition.column ?? dimensionName;
}

function resolveFieldPhysicalColumn(
  ds: CompatibilityDatasetInstance,
  fieldName: string,
): string | undefined {
  return resolveDimensionPhysicalColumn(fieldName, ds.dimensions[fieldName]);
}

function resolveMeasureFilterPhysicalColumn(
  ds: CompatibilityDatasetInstance,
  filter: CompatibilityMetricFilter,
): string | undefined {
  const resolvedField = ds.filters[filter.field]?.field ?? filter.field;
  return resolveFieldPhysicalColumn(ds, resolvedField);
}

function resolveRelationshipTargetPhysicalColumn(
  target: CompatibilityRelationshipTarget,
  fieldName: string,
): string | undefined {
  return resolveDimensionPhysicalColumn(fieldName, target.dimensions?.[fieldName]);
}

function checkDimensionColumns(
  ds: CompatibilityDatasetInstance,
  sourceTable: SnapshotTable,
): DatasetSchemaCompatibilityDiagnostic[] {
  const diagnostics: DatasetSchemaCompatibilityDiagnostic[] = [];

  for (const [dimensionName, definition] of Object.entries(ds.dimensions)) {
    if (definition.sql) {
      diagnostics.push(createSqlExpressionLimitationDiagnostic(ds, dimensionName, 'dimension'));
    }

    const columnName = resolveDimensionPhysicalColumn(dimensionName, definition);
    if (!columnName) {
      continue;
    }

    if (!findSnapshotColumn(sourceTable, columnName)) {
      diagnostics.push(createDiagnostic({
        level: 'error',
        code: 'MissingDimensionColumn',
        datasetName: ds.name,
        fieldName: dimensionName,
        physicalColumnName: columnName,
        sourceName: ds.source,
        message: `Dimension "${dimensionName}" resolves to missing column "${columnName}" on source "${ds.source}".`,
      }));
    }
  }

  return diagnostics;
}

function checkKeyColumn(
  ds: CompatibilityDatasetInstance,
  sourceTable: SnapshotTable,
  keyName: string | undefined,
  code: 'MissingTenantKey' | 'MissingTimeKey',
  label: 'tenantKey' | 'timeKey',
): DatasetSchemaCompatibilityDiagnostic[] {
  if (!keyName) {
    return [];
  }

  if (findSnapshotColumn(sourceTable, keyName)) {
    return [];
  }

  return [
    createDiagnostic({
      level: 'error',
      code,
      datasetName: ds.name,
      fieldName: keyName,
      sourceName: ds.source,
      message: `Dataset "${ds.name}" references missing ${label} column "${keyName}" on source "${ds.source}".`,
    }),
  ];
}

function resolveMeasurePhysicalColumn(
  ds: CompatibilityDatasetInstance,
  definition: CompatibilityMeasureDefinition,
): string | undefined {
  if (definition.sql) {
    return extractSimpleSqlColumn(definition.sql);
  }

  return resolveFieldPhysicalColumn(ds, definition.field);
}

function checkMeasureFilters(
  ds: CompatibilityDatasetInstance,
  sourceTable: SnapshotTable,
  measureName: string,
  filters: CompatibilityMetricFilter[] | undefined,
): DatasetSchemaCompatibilityDiagnostic[] {
  if (!filters?.length) {
    return [];
  }

  const diagnostics: DatasetSchemaCompatibilityDiagnostic[] = [];

  for (const filter of filters) {
    const columnName = resolveMeasureFilterPhysicalColumn(ds, filter);
    if (!columnName) {
      continue;
    }

    if (!findSnapshotColumn(sourceTable, columnName)) {
      diagnostics.push(createDiagnostic({
        level: 'error',
        code: 'InvalidMeasureFilterField',
        datasetName: ds.name,
        fieldName: filter.field,
        physicalColumnName: columnName,
        sourceName: ds.source,
        message: `Measure "${measureName}" uses filter field "${filter.field}" that resolves to missing column "${columnName}" on source "${ds.source}".`,
      }));
    }
  }

  return diagnostics;
}

function checkMeasureDefinition(
  ds: CompatibilityDatasetInstance,
  sourceTable: SnapshotTable,
  measureName: string,
  definition: CompatibilityMeasureDefinition,
): DatasetSchemaCompatibilityDiagnostic[] {
  const diagnostics = checkMeasureFilters(ds, sourceTable, measureName, definition.filters);
  if (definition.sql) {
    diagnostics.push(createSqlExpressionLimitationDiagnostic(ds, measureName, 'measure'));
  }

  const columnName = resolveMeasurePhysicalColumn(ds, definition);

  if (!columnName) {
    return diagnostics;
  }

  const column = findSnapshotColumn(sourceTable, columnName);
  if (!column) {
    diagnostics.push(createDiagnostic({
      level: 'error',
      code: 'MissingMeasureField',
      datasetName: ds.name,
      fieldName: measureName,
      physicalColumnName: columnName,
      sourceName: ds.source,
      message: `Measure "${measureName}" resolves to missing column "${columnName}" on source "${ds.source}".`,
    }));
    return diagnostics;
  }

  if ((definition.aggregation === 'sum' || definition.aggregation === 'avg') && !isNumericClickHouseType(column.type)) {
    diagnostics.push(createDiagnostic({
      level: 'error',
      code: 'IncompatibleNumericMeasureType',
      datasetName: ds.name,
      fieldName: measureName,
      physicalColumnName: columnName,
      sourceName: ds.source,
      message: `Measure "${measureName}" uses ${definition.aggregation} on non-numeric column "${columnName}" of type "${column.type}" on source "${ds.source}".`,
    }));
  }

  return diagnostics;
}

function checkRelationshipDefinitions(
  snapshot: Snapshot,
  ds: CompatibilityDatasetInstance,
  sourceTable: SnapshotTable,
): DatasetSchemaCompatibilityDiagnostic[] {
  const diagnostics: DatasetSchemaCompatibilityDiagnostic[] = [];

  for (const [relationshipName, relationship] of Object.entries(ds.relationships ?? {})) {
    const sourceColumnName = resolveFieldPhysicalColumn(ds, relationship.from) ?? relationship.from;
    if (!findSnapshotColumn(sourceTable, sourceColumnName)) {
      diagnostics.push(createDiagnostic({
        level: 'error',
        code: 'MissingRelationshipSourceColumn',
        datasetName: ds.name,
        fieldName: `${relationshipName}.from`,
        physicalColumnName: sourceColumnName,
        sourceName: ds.source,
        message: `Relationship "${relationshipName}" references missing source column "${sourceColumnName}" on dataset "${ds.name}" source "${ds.source}".`,
      }));
    }

    const target = relationship.target();
    if (!target.source) {
      diagnostics.push(createDiagnostic({
        level: 'error',
        code: 'MissingRelationshipTargetSource',
        datasetName: ds.name,
        fieldName: `${relationshipName}.target`,
        message: `Relationship "${relationshipName}" points to target dataset "${target.name}" without schema compatibility source metadata.`,
      }));
      continue;
    }

    const targetTable = resolveSourceTable(snapshot, target.source);
    if (!targetTable) {
      diagnostics.push(createDiagnostic({
        level: 'error',
        code: 'MissingRelationshipTargetSource',
        datasetName: ds.name,
        fieldName: `${relationshipName}.target`,
        sourceName: target.source,
        message: `Relationship "${relationshipName}" points to target dataset "${target.name}" with missing source "${target.source}".`,
      }));
      continue;
    }

    const targetColumnName = resolveRelationshipTargetPhysicalColumn(target, relationship.to) ?? relationship.to;
    if (!findSnapshotColumn(targetTable, targetColumnName)) {
      diagnostics.push(createDiagnostic({
        level: 'error',
        code: 'MissingRelationshipTargetColumn',
        datasetName: ds.name,
        fieldName: `${relationshipName}.to`,
        physicalColumnName: targetColumnName,
        sourceName: target.source,
        message: `Relationship "${relationshipName}" references missing target column "${targetColumnName}" on dataset "${target.name}" source "${target.source}".`,
      }));
    }
  }

  return diagnostics;
}

function checkDatasetAgainstSchema(
  snapshot: Snapshot,
  ds: CompatibilityDatasetInstance,
): DatasetSchemaCompatibilityDiagnostic[] {
  if (!hasSnapshotSource(snapshot, ds.source)) {
    return [
      createDiagnostic({
        level: 'error',
        code: 'MissingDatasetSource',
        datasetName: ds.name,
        sourceName: ds.source,
        message: `Dataset "${ds.name}" points to missing source "${ds.source}".`,
      }),
    ];
  }

  const sourceTable = resolveSourceTable(snapshot, ds.source);
  if (!sourceTable) {
    return [];
  }

  const diagnostics: DatasetSchemaCompatibilityDiagnostic[] = [
    ...checkDimensionColumns(ds, sourceTable),
    ...checkKeyColumn(ds, sourceTable, ds.tenantKey, 'MissingTenantKey', 'tenantKey'),
    ...checkKeyColumn(ds, sourceTable, ds.timeKey, 'MissingTimeKey', 'timeKey'),
    ...checkRelationshipDefinitions(snapshot, ds, sourceTable),
  ];

  for (const [measureName, definition] of Object.entries(ds.measures)) {
    diagnostics.push(...checkMeasureDefinition(ds, sourceTable, measureName, definition));
  }

  return diagnostics;
}

export function checkDatasetsAgainstSchema(
  input: CheckDatasetsAgainstSchemaInput,
): DatasetSchemaCompatibilityReport {
  const diagnostics = input.datasets.flatMap(dataset => checkDatasetAgainstSchema(input.snapshot, dataset));
  return {
    valid: diagnostics.every(diagnostic => diagnostic.level !== 'error'),
    diagnostics,
  };
}

export function createSemanticCompatibilityAnalyzer(
  options: SemanticCompatibilityPlanOptions,
): MigrationPlanAnalyzer {
  return (plan): MigrationPlanAnalyzerResult => {
    const report = checkDatasetsAgainstSchema({
      snapshot: plan.nextSnapshot,
      datasets: options.datasets,
    });

    return {
      diagnostics: report.diagnostics.map(diagnostic => ({
        level: diagnostic.level,
        kind: `SemanticCompatibility${diagnostic.code}`,
        message: diagnostic.message,
      })),
      blockers: report.diagnostics
        .filter(diagnostic => diagnostic.level === 'error')
        .map(diagnostic => ({
          kind: `SemanticCompatibility${diagnostic.code}`,
          message: diagnostic.message,
          tableName: diagnostic.sourceName,
          ...(diagnostic.physicalColumnName ? { columnName: diagnostic.physicalColumnName } : {}),
        })),
    };
  };
}
