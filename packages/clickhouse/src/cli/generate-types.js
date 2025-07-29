import { ClickHouseConnection } from '../core/connection.js';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from the current directory
dotenv.config();

/**
 * @typedef {Object} ColumnInfo
 * @property {string} name - The name of the column
 * @property {string} type - The ClickHouse type of the column
 */

/**
 * @typedef {Object} GenerateTypesOptions
 * @property {string[]} [includeTables] - List of tables to include
 * @property {string[]} [excludeTables] - List of tables to exclude
 * @property {string[]} [databases] - List of databases to include (default: current database only)
 */

/**
 * Converts ClickHouse types to TypeScript types
 * @param {string} type - The ClickHouse type to convert
 * @returns {string} - The corresponding TypeScript type
 */
const clickhouseToTsType = (type) => {
  if (type.startsWith('Array(')) {
    const innerType = type.slice(6, -1);
    return `Array<${clickhouseToTsType(innerType)}>`;
  }

  // Handle Nullable types
  if (type.startsWith('Nullable(')) {
    const innerType = type.slice(9, -1);
    return `${clickhouseToTsType(innerType)} | null`;
  }

  // Handle Map types
  if (type.startsWith('Map(')) {
    // Extract key and value types from Map(KeyType, ValueType)
    const mapContent = type.slice(4, -1); // Remove 'Map(' and ')'
    const commaIndex = mapContent.lastIndexOf(',');
    if (commaIndex !== -1) {
      const keyType = mapContent.substring(0, commaIndex).trim();
      const valueType = mapContent.substring(commaIndex + 1).trim();

      // Handle different key types
      let keyTsType = 'string';
      if (keyType === 'LowCardinality(String)') {
        keyTsType = 'string';
      } else if (keyType.includes('Int') || keyType.includes('UInt')) {
        keyTsType = 'number';
      }

      // Handle different value types
      let valueTsType = 'unknown';
      if (valueType.startsWith('Array(')) {
        const innerType = valueType.slice(6, -1);
        valueTsType = `Array<${clickhouseToTsType(innerType)}>`;
      } else if (valueType.startsWith('Nullable(')) {
        const innerType = valueType.slice(9, -1);
        valueTsType = `${clickhouseToTsType(innerType)} | null`;
      } else {
        valueTsType = clickhouseToTsType(valueType);
      }

      return `Record<${keyTsType}, ${valueTsType}>`;
    }
    return 'Record<string, unknown>';
  }

  switch (type.toLowerCase()) {
    case 'string':
    case 'fixedstring':
      return 'string';
    case 'int8':
    case 'int16':
    case 'int32':
    case 'uint8':
    case 'int64':
    case 'uint16':
    case 'uint32':
    case 'uint64':
      return 'number';
    case 'uint128':
    case 'uint256':
    case 'int128':
    case 'int256':
      return 'string';
    case 'float32':
    case 'float64':
    case 'decimal':
      return 'number';
    case 'datetime':
    case 'datetime64':
      return 'string'; // Use string for datetime
    case 'date':
    case 'date32':
      return 'string'; // Use string for date
    case 'bool':
    case 'boolean':
      return 'boolean';
    default:
      // For complex types or unknown types, return string as a safe default
      return 'string';
  }
};

/**
 * Gets all tables from a specific database
 * @param {Object} client - ClickHouse client
 * @param {string} database - Database name
 * @param {string[]} includeTables - Tables to include
 * @param {string[]} excludeTables - Tables to exclude
 * @returns {Promise<Array>} - Array of table objects
 */
async function getTablesFromDatabase(client, database, includeTables = [], excludeTables = []) {
  const tablesQuery = await client.query({
    query: `SHOW TABLES FROM ${database}`,
    format: 'JSONEachRow'
  });
  let tables = await tablesQuery.json();

  // Filter tables if includeTables or excludeTables are specified
  if (includeTables.length > 0) {
    tables = tables.filter(table => includeTables.includes(table.name));
  }

  if (excludeTables.length > 0) {
    tables = tables.filter(table => !excludeTables.includes(table.name));
  }

  return tables.map(table => ({ ...table, database }));
}

/**
 * Gets columns for a table in a specific database
 * @param {Object} client - ClickHouse client
 * @param {string} database - Database name
 * @param {string} table - Table name
 * @returns {Promise<Array>} - Array of column objects
 */
async function getTableColumns(client, database, table) {
  const columnsQuery = await client.query({
    query: `DESCRIBE TABLE ${database}.${table}`,
    format: 'JSONEachRow'
  });
  return await columnsQuery.json();
}

/**
 * Generates TypeScript type definitions from the ClickHouse database schema
 * @param {string} outputPath - The file path where the type definitions will be written
 * @param {GenerateTypesOptions} [options] - Options for type generation
 * @returns {Promise<void>}
 */
export async function generateTypes(outputPath, options = {}) {
  const client = ClickHouseConnection.getClient();
  const { includeTables = [], excludeTables = [], databases = [] } = options;

  // If no databases specified, use the current database
  const databasesToProcess = databases.length > 0 ? databases : ['default'];

  let typeDefinitions = `// Generated by @hypequery/clickhouse
// This file defines TypeScript types based on your ClickHouse database schema

/**
 * Schema interface for use with createQueryBuilder<IntrospectedSchema>()
 * The string literals represent ClickHouse data types for each column
 */
export interface IntrospectedSchema {`;

  // Process each database
  for (const database of databasesToProcess) {
    console.log(`Processing database: ${database}`);

    try {
      const tables = await getTablesFromDatabase(client, database, includeTables, excludeTables);

      if (tables.length === 0) {
        console.warn(`Warning: No tables found in database '${database}' or no tables match the filter criteria.`);
        continue;
      }

      // If this is the default database (or only database), add tables directly
      if (databasesToProcess.length === 1 || database === 'default') {
        for (const table of tables) {
          const columns = await getTableColumns(client, database, table.name);
          typeDefinitions += `\n  ${table.name}: {`;
          for (const column of columns) {
            const clickHouseType = column.type.replace(/'/g, "\\'"); // Escape single quotes, e.g. `DateTime('UTC')`
            typeDefinitions += `\n    '${column.name}': '${clickHouseType}';`;
          }
          typeDefinitions += '\n  };';
        }
      } else {
        // For non-default databases, add them to the __databases section
        if (!typeDefinitions.includes('__databases')) {
          typeDefinitions += `\n  __databases: {`;
        }

        typeDefinitions += `\n    ${database}: {`;
        for (const table of tables) {
          const columns = await getTableColumns(client, database, table.name);
          typeDefinitions += `\n      ${table.name}: {`;
          for (const column of columns) {
            const clickHouseType = column.type.replace(/'/g, "\\'"); // Escape single quotes, e.g. `DateTime('UTC')`
            typeDefinitions += `\n        '${column.name}': '${clickHouseType}';`;
          }
          typeDefinitions += '\n      };';
        }
        typeDefinitions += '\n    };';
      }
    } catch (error) {
      console.error(`Error processing database '${database}':`, error.message);
      // Continue with other databases
    }
  }

  // Close the __databases section if it was opened
  if (typeDefinitions.includes('__databases')) {
    typeDefinitions += '\n  };';
  }

  typeDefinitions += '\n}\n';

  // Generate type-safe record types for each table
  typeDefinitions += `\n// Type-safe record types for each table\n`;

  for (const database of databasesToProcess) {
    try {
      const tables = await getTablesFromDatabase(client, database, includeTables, excludeTables);

      for (const table of tables) {
        const columns = await getTableColumns(client, database, table.name);
        const tableTypeName = capitalizeFirstLetter(table.name);

        typeDefinitions += `export interface ${tableTypeName}Record {`;
        for (const column of columns) {
          const tsType = clickhouseToTsType(column.type).replace(/'/g, '');
          typeDefinitions += `\n  '${column.name}': ${tsType};`;
        }
        typeDefinitions += '\n}\n\n';
      }
    } catch (error) {
      console.error(`Error generating record types for database '${database}':`, error.message);
    }
  }

  // Add usage examples
  typeDefinitions += `
/**
 * Usage examples:
 * 
 * import { createQueryBuilder } from '@hypequery/clickhouse';
 * import { IntrospectedSchema } from './path-to-this-file';
 * 
 * // Create a type-safe query builder
 * const db = createQueryBuilder<IntrospectedSchema>();
 * 
 * // Query from default database (existing API - unchanged)
 * const results = await db
 *   .table('${databasesToProcess.includes('default') ? 'table_name' : 'users'}')
 *   .select(['column1', 'column2'])
 *   .where('column1', 'eq', 'value')
 *   .execute();
 * 
 * // Query from cross-database table
 * const crossDbResults = await db
 *   .crossTable('information_schema.tables')
 *   .select(['table_name', 'table_schema'])
 *   .where('table_schema', 'eq', 'default')
 *   .execute();
 * 
 * // Cross-database join
 * const joinedResults = await db
 *   .table('users')
 *   .leftJoinCrossDatabase('information_schema.tables', 'name', 'information_schema.tables.table_name')
 *   .select(['users.name', 'information_schema.tables.table_type'])
 *   .where('information_schema.tables.table_schema', 'eq', 'default')
 *   .execute();
 */
`;

  // Ensure the output directory exists
  const outputDir = path.dirname(path.resolve(outputPath));
  await fs.mkdir(outputDir, { recursive: true });

  // Write the file
  await fs.writeFile(path.resolve(outputPath), typeDefinitions);
}

/**
 * Capitalize the first letter of a string
 * @param {string} str - The string to capitalize
 * @returns {string} - The capitalized string
 */
function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
} 
