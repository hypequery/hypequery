/**
 * Dataset Generator
 *
 * Generates dataset DSL code from schema introspection (ClickHouse or
 * Postgres). This reduces quickstart friction by auto-scaffolding dataset
 * definitions.
 */

import fs from 'fs/promises';
import path from 'path';
import type { TypeGenerationClickHouseClient } from '../typegen/index.js';
import { getClickHouseClient } from '../utils/clickhouse-client.js';
import { clickhouseIntrospector } from './introspection/clickhouse.js';
import type {
  IntrospectedColumn,
  IntrospectedForeignKey,
  IntrospectedTable,
  SchemaIntrospector,
} from './introspection/types.js';

export interface DatasetGeneratorOptions {
  outputPath: string;
  includeTables?: string[];
  excludeTables?: string[];
  client?: TypeGenerationClickHouseClient;
  /** The schema to introspect; defaults to ClickHouse over `client` or the environment. */
  introspector?: SchemaIntrospector;
  /**
   * Tenant column the caller has already configured as a trusted runtime tenant
   * scope (for example the `tenant.column` of a scaffolded context-auth API).
   *
   * Only an explicit value here activates `tenantKey`; column-name heuristics
   * never do. Tables that lack the column are reported as warnings instead of
   * being silently left unscoped.
   */
  tenantColumn?: string;
  /** Whether to write the output file. Defaults to true; false renders only. */
  writeOutput?: boolean;
}

export type DatasetGenerationWarning =
  | {
      kind: 'tenant-key-candidate';
      table: string;
      columns: string[];
      message: string;
    }
  | {
      kind: 'tenant-column-missing';
      table: string;
      column: string;
      message: string;
    };

type ColumnInfo = IntrospectedColumn;

/**
 * Check if a column is likely a timestamp column
 */
function isTimestampColumn(column: ColumnInfo): boolean {
  const name = column.name.toLowerCase();

  return (
    column.temporal ||
    name.includes('timestamp') ||
    name.includes('_at') ||
    name === 'created' ||
    name === 'updated'
  );
}

/**
 * Check if a column name is worth presenting as a possible tenant key.
 *
 * A naming match is never enough to activate tenant enforcement. `tenantKey`
 * is a security boundary that must be chosen explicitly by the application.
 */
function isTenantKeyCandidate(column: ColumnInfo): boolean {
  const name = column.name.toLowerCase();

  return (
    name === 'tenant_id' ||
    name === 'organization_id' ||
    name === 'org_id' ||
    name === 'account_id' ||
    name === 'customer_id'
  );
}

/**
 * Check if a column is numeric and suitable for measures
 */
function isNumericColumn(column: ColumnInfo): boolean {
  return column.numeric;
}

/**
 * Check if a numeric column is more likely an identifier than an additive value.
 */
function isIdentifierColumn(column: ColumnInfo): boolean {
  const originalName = column.name;
  const name = column.name.toLowerCase();

  return (
    name === 'id' ||
    name === 'uuid' ||
    name.endsWith('_id') ||
    originalName.endsWith('Id') ||
    name.includes('uuid') ||
    isTenantKeyCandidate(column)
  );
}

/**
 * Check if a numeric column is a coordinate that should not be summed or averaged.
 */
function isCoordinateColumn(column: ColumnInfo): boolean {
  const name = column.name.toLowerCase();

  return (
    name === 'lat' ||
    name === 'lng' ||
    name === 'lon' ||
    name === 'latitude' ||
    name === 'longitude' ||
    name.endsWith('_lat') ||
    name.endsWith('_lng') ||
    name.endsWith('_lon') ||
    name.endsWith('_latitude') ||
    name.endsWith('_longitude')
  );
}

function isMeasureCandidate(column: ColumnInfo): boolean {
  return isNumericColumn(column) && !isIdentifierColumn(column) && !isCoordinateColumn(column);
}

/**
 * Convert table name to PascalCase for dataset variable name
 */
function tableToPascalCase(tableName: string): string {
  return tableName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Convert column name to camelCase for field name
 */
function columnToCamelCase(columnName: string): string {
  const parts = columnName.split('_');
  return parts[0] + parts.slice(1).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

/**
 * Generate a human-readable label from a column name
 */
function generateLabel(columnName: string): string {
  return columnName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate dataset definition code for a single table
 */
async function generateDatasetForTable(
  introspector: SchemaIntrospector,
  table: IntrospectedTable,
  exportNames: ReadonlyMap<string, string>,
  foreignKeys: readonly IntrospectedForeignKey[],
  tenantColumn?: string
): Promise<{ code: string; warnings: DatasetGenerationWarning[]; usesRelationships: boolean }> {
  const tableName = table.name;
  const columns = await introspector.describeTable(table);

  // Determine timeKey (prefer created_at, then any timestamp column)
  const timestampColumns = columns.filter(isTimestampColumn);
  const timeKeyColumn = timestampColumns.find((c) => c.name === 'created_at') || timestampColumns[0];

  // A tenant column is only honoured when the caller configured one explicitly.
  // Column-name matches are reported for review and never become policy.
  const resolvedTenantColumn = tenantColumn
    ? columns.find((column) => column.name === tenantColumn)?.name
    : undefined;
  // Report every match, not just the first — picking the right tenant boundary
  // needs the full set (e.g. both `organization_id` and `customer_id`).
  const tenantCandidates = columns.filter(isTenantKeyCandidate).map((column) => column.name);
  const warnings: DatasetGenerationWarning[] = [];

  if (tenantColumn && !resolvedTenantColumn) {
    warnings.push({
      kind: 'tenant-column-missing',
      table: tableName,
      column: tenantColumn,
      message:
        `Dataset "${tableName}" has no "${tenantColumn}" column, so tenant isolation was not applied. ` +
        'Tenant-scoped requests against it will fail until you set tenantKey to the correct column.',
    });
  }

  if (!resolvedTenantColumn && tenantCandidates.length > 0) {
    const quoted = tenantCandidates.map((name) => `"${name}"`).join(', ');
    warnings.push({
      kind: 'tenant-key-candidate',
      table: tableName,
      columns: tenantCandidates,
      message:
        `Dataset "${tableName}" has ${tenantCandidates.length === 1 ? 'possible tenant key' : 'possible tenant keys'} ${quoted}. ` +
        'Review them and add tenantKey explicitly only after configuring trusted runtime tenant scope.',
    });
  }

  // Generate dimensions
  const dimensionLines: string[] = [];
  for (const column of columns) {
    const fieldName = columnToCamelCase(column.name);
    const dimensionType = column.dimensionType;
    const label = generateLabel(column.name);

    // Skip if column name === fieldName (no transformation needed)
    if (column.name === fieldName) {
      dimensionLines.push(`    ${fieldName}: dimension.${dimensionType}({ label: '${label}' }),`);
    } else {
      dimensionLines.push(
        `    ${fieldName}: dimension.${dimensionType}({ column: '${column.name}', label: '${label}' }),`
      );
    }
  }

  // Generate measures for numeric value columns only. IDs and coordinates stay
  // dimensions because summing or averaging them is usually noise.
  const numericColumns = columns.filter(isMeasureCandidate);
  const measureLines: string[] = [];

  if (numericColumns.length > 0) {
    measureLines.push(`    // Count measures`);
    measureLines.push(`    totalCount: measure.count('${columnToCamelCase(columns[0].name)}', { label: 'Total Count' }),`);
    measureLines.push(``);

    for (const column of numericColumns) {
      const fieldName = columnToCamelCase(column.name);
      const label = generateLabel(column.name);

      measureLines.push(`    // ${label} measures`);
      measureLines.push(`    total${tableToPascalCase(column.name)}: measure.sum('${fieldName}', { label: 'Total ${label}' }),`);
      measureLines.push(`    avg${tableToPascalCase(column.name)}: measure.avg('${fieldName}', { label: 'Average ${label}' }),`);
      measureLines.push(``);
    }
  } else {
    measureLines.push(`    totalCount: measure.count('${columnToCamelCase(columns[0].name)}', { label: 'Total Count' }),`);
  }

  // Build the dataset definition
  const datasetName = tableToPascalCase(tableName);
  const configLines: string[] = [];

  configLines.push(`  source: '${table.source}',`);

  if (timeKeyColumn) {
    configLines.push(`  timeKey: '${timeKeyColumn.name}',`);
  }

  if (resolvedTenantColumn) {
    configLines.push(`  tenantKey: '${resolvedTenantColumn}',`);
  } else if (tenantCandidates.length > 0) {
    const quoted = tenantCandidates.map((name) => `'${name}'`).join(', ');
    configLines.push(
      `  // Possible tenant ${tenantCandidates.length === 1 ? 'key' : 'keys'}: ${quoted}.`,
    );
    configLines.push(`  // Add tenantKey explicitly only after configuring trusted runtime tenant scope.`);
  }

  configLines.push(`  dimensions: {`);
  configLines.push(...dimensionLines);
  configLines.push(`  },`);
  configLines.push(`  measures: {`);
  configLines.push(...measureLines);
  configLines.push(`  },`);

  const relationshipLines = relationshipDefinitions(columns, foreignKeys, exportNames);
  if (relationshipLines.length > 0) {
    configLines.push(`  relationships: {`);
    configLines.push(...relationshipLines);
    configLines.push(`  },`);
  }

  return {
    code: `export const ${datasetName}Dataset = dataset('${tableName}', {
${configLines.join('\n')}
});
`,
    warnings,
    usesRelationships: relationshipLines.length > 0,
  };
}

/**
 * `belongsTo` relationships from single-column foreign keys. A relationship is
 * named for its key column without the `_id`/`Id` suffix (`customer_id` →
 * `customer`), falling back to the target dataset when that name is taken.
 * Keys are physical columns on both sides.
 */
function relationshipDefinitions(
  columns: readonly ColumnInfo[],
  foreignKeys: readonly IntrospectedForeignKey[],
  exportNames: ReadonlyMap<string, string>,
): string[] {
  const taken = new Set(columns.map((column) => columnToCamelCase(column.name)));
  const lines: string[] = [];
  for (const key of foreignKeys) {
    const target = exportNames.get(key.target);
    if (!target) continue;
    const stem = key.column.replace(/(_id|Id)$/, '');
    let name = columnToCamelCase(stem === key.column ? `${key.column}_ref` : stem);
    if (taken.has(name)) name = columnToCamelCase(key.target);
    if (taken.has(name)) continue;
    taken.add(name);
    lines.push(`    ${name}: belongsTo(() => ${target}, { from: '${key.column}', to: '${key.targetColumn}' }),`);
  }
  return lines;
}

/**
 * Generate dataset definitions from ClickHouse schema
 */
export async function generateDatasets(options: DatasetGeneratorOptions) {
  const introspector = options.introspector ?? clickhouseIntrospector(options.client ?? getClickHouseClient());

  // Get all tables
  let tables = await introspector.listTables();

  // Filter tables
  if (options.includeTables && options.includeTables.length > 0) {
    tables = tables.filter((table) => options.includeTables!.includes(table.name));
  }

  if (options.excludeTables && options.excludeTables.length > 0) {
    tables = tables.filter((table) => !options.excludeTables!.includes(table.name));
  }

  if (tables.length === 0) {
    throw new Error('No tables found matching the specified criteria');
  }

  // Generate dataset definitions
  const datasetDefinitions: string[] = [];
  const warnings: DatasetGenerationWarning[] = [];
  const exportNames = new Map(tables.map((table) => [table.name, `${tableToPascalCase(table.name)}Dataset`]));
  const foreignKeys = introspector.foreignKeys ? await introspector.foreignKeys(tables) : new Map();
  let usesRelationships = false;

  for (const table of tables) {
    const generated = await generateDatasetForTable(
      introspector, table, exportNames, foreignKeys.get(table.name) ?? [], options.tenantColumn,
    );
    datasetDefinitions.push(generated.code);
    warnings.push(...generated.warnings);
    usesRelationships ||= generated.usesRelationships;
  }

  // Build the complete output file
  const imports = usesRelationships ? 'belongsTo, dataset, dimension, measure' : 'dataset, dimension, measure';
  const header = `// Generated by @hypequery/cli
// This file defines dataset definitions based on your ${introspector.engine} database schema

import { ${imports} } from '@hypequery/datasets';

`;

  const footer = `
// Export all datasets as a registry
export const datasets = {
${tables.map((table) => `  ${table.name}: ${tableToPascalCase(table.name)}Dataset,`).join('\n')}
};
`;

  const output = header + datasetDefinitions.join('\n') + footer;

  if (options.writeOutput !== false) {
    // Ensure output directory exists
    const outputDir = path.dirname(path.resolve(options.outputPath));
    await fs.mkdir(outputDir, { recursive: true });

    // Write the file
    await fs.writeFile(path.resolve(options.outputPath), output);
  }

  // Returned so the CLI can report what it actually generated, and print an
  // example that matches the file rather than a hardcoded placeholder.
  return {
    tables: tables.map((table) => table.name),
    exports: tables.map((table) => ({
      table: table.name,
      exportName: `${tableToPascalCase(table.name)}Dataset`,
    })),
    warnings,
    contents: output,
  };
}
