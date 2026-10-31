/**
 * Dataset Generator
 *
 * Generates dataset DSL code from ClickHouse schema introspection.
 * This reduces quickstart friction by auto-scaffolding dataset definitions.
 */

import fs from 'fs/promises';
import path from 'path';
import type { TypeGenerationClickHouseClient } from '../typegen/index.js';
import { getClickHouseClient } from '../utils/clickhouse-client.js';
import {
  clickHouseDimensionType,
  namedTupleElements,
  type ScaffoldDimensionType,
} from '../utils/clickhouse-dimension-type.js';
import { createFieldNamer } from '../utils/field-namer.js';
import { isTenantKeyCandidateName } from '../utils/tenant-key-candidates.js';

export interface DatasetGeneratorOptions {
  outputPath: string;
  includeTables?: string[];
  excludeTables?: string[];
  client?: TypeGenerationClickHouseClient;
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

interface ColumnInfo {
  name: string;
  type: string;
  default_type: string;
  default_expression: string;
}

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One generated dimension: a whole column, or one element of a named tuple column. */
interface DimensionField {
  column: ColumnInfo;
  element?: string;
  type: ScaffoldDimensionType;
  name: string;
  /** The natural name another field already holds. */
  renamedFrom?: string;
}

/**
 * Whether a column can be the dataset's timeKey: its values are dates or times.
 */
function isTimestampColumn(column: ColumnInfo): boolean {
  return clickHouseDimensionType(column.type) === 'timestamp';
}

function isTenantKeyCandidate(column: ColumnInfo): boolean {
  return isTenantKeyCandidateName(column.name);
}

/**
 * Check if a column is numeric and suitable for measures
 */
function isNumericColumn(column: ColumnInfo): boolean {
  return clickHouseDimensionType(column.type) === 'number';
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
  client: TypeGenerationClickHouseClient,
  tableName: string,
  tenantColumn?: string
): Promise<{ code: string; warnings: DatasetGenerationWarning[] }> {
  // Get column information
  const columnsQuery = await client.query({
    query: `DESCRIBE TABLE ${tableName}`,
    format: 'JSONEachRow',
  });
  const columns = await columnsQuery.json() as unknown as ColumnInfo[];

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

  // Generate dimensions. A named tuple becomes one dimension per scalar
  // element; columns no dimension type describes are left out with a note.
  const fields: DimensionField[] = [];
  const skippedColumns: ColumnInfo[] = [];
  for (const column of columns) {
    const dimensionType = clickHouseDimensionType(column.type);
    if (dimensionType) {
      fields.push({ column, type: dimensionType, name: columnToCamelCase(column.name) });
      continue;
    }
    const elements = SQL_IDENTIFIER.test(column.name) ? namedTupleElements(column.type) : null;
    if (elements?.length) {
      for (const element of elements) {
        fields.push({
          column,
          element: element.name,
          type: element.type,
          name: columnToCamelCase(`${column.name}_${element.name}`),
        });
      }
      continue;
    }
    skippedColumns.push(column);
  }

  // Field names are SQL aliases, so none may shadow a source column another
  // field reads. A column spelled like its field keeps that name, then other
  // columns, then tuple elements; a clash takes a numeric suffix instead.
  const nameField = createFieldNamer(columns.map((column) => column.name));
  const naming = [
    ...fields.filter((field) => !field.element && field.name === field.column.name),
    ...fields.filter((field) => !field.element && field.name !== field.column.name),
    ...fields.filter((field) => field.element),
  ];
  for (const field of naming) {
    const name = nameField(field.name, field.element ? undefined : field.column.name);
    if (name !== field.name) field.renamedFrom = field.name;
    field.name = name;
  }
  const fieldNameByColumn = new Map(
    fields.filter((field) => !field.element).map((field) => [field.column.name, field.name]),
  );

  const dimensionLines: string[] = [];
  for (const column of columns) {
    if (skippedColumns.includes(column)) {
      // ClickHouse can spell a nested type over several lines; keep the note on one comment line.
      const type = column.type.replace(/\s+/g, ' ');
      dimensionLines.push(
        `    // ${column.name} (${type}) is not included: no dimension type describes its values.`
      );
      continue;
    }
    for (const field of fields.filter((candidate) => candidate.column === column)) {
      const label = generateLabel(column.name);
      if (field.renamedFrom) {
        dimensionLines.push(
          `    // ${field.element ? `${column.name}.${field.element}` : column.name} is ${field.name}: ${field.renamedFrom} is taken by another field or column.`
        );
      }
      if (field.element) {
        dimensionLines.push(
          `    ${field.name}: dimension.${field.type}({ sql: "tupleElement(${column.name}, '${field.element}')", ` +
            `dependencies: ['${column.name}'], label: '${label} ${generateLabel(field.element)}' }),`
        );
      } else if (column.name === field.name) {
        // No column option needed when the field is spelled like the column
        dimensionLines.push(`    ${field.name}: dimension.${field.type}({ label: '${label}' }),`);
      } else {
        dimensionLines.push(
          `    ${field.name}: dimension.${field.type}({ column: '${column.name}', label: '${label}' }),`
        );
      }
    }
  }

  // Generate measures for numeric value columns only. IDs and coordinates stay
  // dimensions because summing or averaging them is usually noise.
  const numericColumns = columns.filter(isMeasureCandidate);
  const measureLines: string[] = [];
  const countField = fields[0]?.name;

  if (numericColumns.length > 0) {
    measureLines.push(`    // Count measures`);
    measureLines.push(`    ${nameField('totalCount')}: measure.count('${countField}', { label: 'Total Count' }),`);
    measureLines.push(``);

    for (const column of numericColumns) {
      const fieldName = fieldNameByColumn.get(column.name)!;
      const measureSuffix = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
      const label = generateLabel(column.name);

      measureLines.push(`    // ${label} measures`);
      measureLines.push(`    ${nameField(`total${measureSuffix}`)}: measure.sum('${fieldName}', { label: 'Total ${label}' }),`);
      measureLines.push(`    ${nameField(`avg${measureSuffix}`)}: measure.avg('${fieldName}', { label: 'Average ${label}' }),`);
      measureLines.push(``);
    }
  } else if (countField) {
    measureLines.push(`    ${nameField('totalCount')}: measure.count('${countField}', { label: 'Total Count' }),`);
  }

  // Build the dataset definition
  const datasetName = tableToPascalCase(tableName);
  const configLines: string[] = [];

  configLines.push(`  source: '${tableName}',`);

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

  return {
    code: `export const ${datasetName}Dataset = dataset('${tableName}', {
${configLines.join('\n')}
});
`,
    warnings,
  };
}

/**
 * Generate dataset definitions from ClickHouse schema
 */
export async function generateDatasets(options: DatasetGeneratorOptions) {
  const client = options.client ?? getClickHouseClient();

  // Get all tables
  const tablesQuery = await client.query({
    query: 'SHOW TABLES',
    format: 'JSONEachRow',
  });
  let tables = await tablesQuery.json() as unknown as Array<{ name: string }>;

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
  const warnings: DatasetGenerationWarning[] = [];

  for (const table of tables) {
    const generated = await generateDatasetForTable(client, table.name, options.tenantColumn);
    datasetDefinitions.push(generated.code);
    warnings.push(...generated.warnings);
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
