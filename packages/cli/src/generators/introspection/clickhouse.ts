import type { TypeGenerationClickHouseClient } from '../../typegen/index.js';
import type { GeneratedDimensionType, IntrospectedColumn, IntrospectedTable, SchemaIntrospector } from './types.js';

interface ClickHouseColumn {
  name: string;
  type: string;
}

/** The dataset dimension type for a ClickHouse type. */
export function clickhouseToDimensionType(chType: string): GeneratedDimensionType {
  const normalized = chType.toLowerCase();
  if (normalized.includes('string') || normalized.includes('enum')) return 'string';
  if (
    normalized.includes('int') ||
    normalized.includes('float') ||
    normalized.includes('double') ||
    normalized.includes('decimal')
  ) {
    return 'number';
  }
  if (normalized.includes('date') || normalized.includes('datetime')) return 'timestamp';
  if (normalized.includes('bool')) return 'boolean';
  return 'string';
}

function isNumericType(chType: string): boolean {
  const type = chType.toLowerCase();
  return type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal');
}

function isTemporalType(chType: string): boolean {
  const type = chType.toLowerCase();
  return type.includes('date') || type.includes('datetime');
}

/** Introspect the configured ClickHouse database with `SHOW TABLES` and `DESCRIBE TABLE`. */
export function clickhouseIntrospector(client: TypeGenerationClickHouseClient): SchemaIntrospector {
  return {
    engine: 'ClickHouse',
    async listTables(): Promise<IntrospectedTable[]> {
      const result = await client.query({ query: 'SHOW TABLES', format: 'JSONEachRow' });
      const tables = await result.json() as unknown as Array<{ name: string }>;
      return tables
        // System and materialized-view inner tables are never datasets.
        .filter((table) => !table.name.startsWith('system.') && !table.name.startsWith('.inner'))
        .map((table) => ({ name: table.name, source: table.name }));
    },
    async describeTable(table: IntrospectedTable): Promise<IntrospectedColumn[]> {
      const result = await client.query({ query: `DESCRIBE TABLE ${table.source}`, format: 'JSONEachRow' });
      const columns = await result.json() as unknown as ClickHouseColumn[];
      return columns.map((column) => ({
        name: column.name,
        type: column.type,
        dimensionType: clickhouseToDimensionType(column.type),
        numeric: isNumericType(column.type),
        temporal: isTemporalType(column.type),
      }));
    },
  };
}
