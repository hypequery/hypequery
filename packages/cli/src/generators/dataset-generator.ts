/**
 * Dataset Generator
 *
 * Generates dataset DSL code from ClickHouse schema introspection.
 * This reduces quickstart friction by auto-scaffolding dataset definitions.
 */

import fs from 'fs/promises';
import path from 'path';
import { getClickHouseClient } from '../utils/clickhouse-client.js';

export interface DatasetGeneratorOptions {
  outputPath: string;
  includeTables?: string[];
  excludeTables?: string[];
}

interface ColumnInfo {
  name: string;
  type: string;
  default_type: string;
  default_expression: string;
}

/**
 * Determine the dataset dimension type from a ClickHouse type
 */
function clickhouseToDimensionType(chType: string): string {
  const normalized = chType.toLowerCase();

  // String types
  if (normalized.includes('string') || normalized.includes('enum')) {
    return 'string';
  }

  // Numeric types
  if (
    normalized.includes('int') ||
    normalized.includes('float') ||
    normalized.includes('double') ||
    normalized.includes('decimal')
  ) {
    return 'number';
  }

  // Date/Time types
  if (normalized.includes('date') || normalized.includes('datetime')) {
    return 'timestamp';
  }

  // Boolean
  if (normalized.includes('bool')) {
    return 'boolean';
  }

  // Default to string for unknown types
  return 'string';
}

/**
 * Check if a column is likely a timestamp column
 */
function isTimestampColumn(column: ColumnInfo): boolean {
  const name = column.name.toLowerCase();
  const type = column.type.toLowerCase();

  return (
    type.includes('date') ||
    type.includes('datetime') ||
    name.includes('timestamp') ||
    name.includes('_at') ||
    name === 'created' ||
    name === 'updated'
  );
}

/**
 * Check if a column is likely a tenant ID column
 */
function isTenantColumn(column: ColumnInfo): boolean {
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
  const type = column.type.toLowerCase();

  return (
    type.includes('int') ||
    type.includes('float') ||
    type.includes('double') ||
    type.includes('decimal')
  );
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
  client: any,
  tableName: string
): Promise<string> {
  // Get column information
  const columnsQuery = await client.query({
    query: `DESCRIBE TABLE ${tableName}`,
    format: 'JSONEachRow',
  });
  const columns: ColumnInfo[] = await columnsQuery.json();

  // Determine timeKey (prefer created_at, then any timestamp column)
  const timestampColumns = columns.filter(isTimestampColumn);
  const timeKeyColumn = timestampColumns.find((c) => c.name === 'created_at') || timestampColumns[0];

  // Determine tenantKey
  const tenantColumn = columns.find(isTenantColumn);

  // Generate dimensions
  const dimensionLines: string[] = [];
  for (const column of columns) {
    const fieldName = columnToCamelCase(column.name);
    const dimensionType = clickhouseToDimensionType(column.type);
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

  // Generate measures (for numeric columns only)
  const numericColumns = columns.filter(isNumericColumn).filter((c) => !isTenantColumn(c));
  const measureLines: string[] = [];

  if (numericColumns.length > 0) {
    measureLines.push(`    // Count measures`);
    measureLines.push(`    totalCount: measure.count({ label: 'Total Count' }),`);
    measureLines.push(``);

    for (const column of numericColumns) {
      const fieldName = columnToCamelCase(column.name);
      const label = generateLabel(column.name);

      measureLines.push(`    // ${label} measures`);
      measureLines.push(`    total${tableToPascalCase(column.name)}: measure.sum('${column.name}', { label: 'Total ${label}' }),`);
      measureLines.push(`    avg${tableToPascalCase(column.name)}: measure.avg('${column.name}', { label: 'Average ${label}' }),`);
      measureLines.push(``);
    }
  } else {
    measureLines.push(`    totalCount: measure.count({ label: 'Total Count' }),`);
  }

  // Build the dataset definition
  const datasetName = tableToPascalCase(tableName);
  const configLines: string[] = [];

  configLines.push(`  source: '${tableName}',`);

  if (timeKeyColumn) {
    configLines.push(`  timeKey: '${timeKeyColumn.name}',`);
  }

  if (tenantColumn) {
    configLines.push(`  tenantKey: '${tenantColumn.name}', // Auto-detected tenant isolation column`);
  }

  configLines.push(`  dimensions: {`);
  configLines.push(...dimensionLines);
  configLines.push(`  },`);
  configLines.push(`  measures: {`);
  configLines.push(...measureLines);
  configLines.push(`  },`);

  return `export const ${datasetName}Dataset = dataset('${tableName}', {
${configLines.join('\n')}
});
`;
}

/**
 * Generate dataset definitions from ClickHouse schema
 */
export async function generateDatasets(options: DatasetGeneratorOptions) {
  const client = getClickHouseClient();

  // Get all tables
  const tablesQuery = await client.query({
    query: 'SHOW TABLES',
    format: 'JSONEachRow',
  });
  let tables: Array<{ name: string }> = await tablesQuery.json();

  // Filter tables
  if (options.includeTables && options.includeTables.length > 0) {
    tables = tables.filter((table) => options.includeTables!.includes(table.name));
  }

  if (options.excludeTables && options.excludeTables.length > 0) {
    tables = tables.filter((table) => !options.excludeTables!.includes(table.name));
  }

  // Filter out system tables
  tables = tables.filter((table) => !table.name.startsWith('system.') && !table.name.startsWith('.inner'));

  if (tables.length === 0) {
    throw new Error('No tables found matching the specified criteria');
  }

  // Generate dataset definitions
  const datasetDefinitions: string[] = [];

  for (const table of tables) {
    const datasetCode = await generateDatasetForTable(client, table.name);
    datasetDefinitions.push(datasetCode);
  }

  // Build the complete output file
  const header = `// Generated by @hypequery/cli
// This file defines dataset definitions based on your ClickHouse database schema

import { dataset, dimension, measure } from '@hypequery/datasets';

`;

  const footer = `
// Export all datasets as a registry
export const datasets = {
${tables.map((table) => `  ${table.name}: ${tableToPascalCase(table.name)}Dataset,`).join('\n')}
};
`;

  const output = header + datasetDefinitions.join('\n') + footer;

  // Ensure output directory exists
  const outputDir = path.dirname(path.resolve(options.outputPath));
  await fs.mkdir(outputDir, { recursive: true });

  // Write the file
  await fs.writeFile(path.resolve(options.outputPath), output);
}
