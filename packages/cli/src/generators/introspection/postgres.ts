import type {
  GeneratedDimensionType,
  IntrospectedColumn,
  IntrospectedForeignKey,
  IntrospectedTable,
  SchemaIntrospector,
} from './types.js';

/** The subset of a node-postgres client introspection uses. */
export interface PostgresIntrospectionClient {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

const NUMERIC_TYPES = new Set([
  'smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'decimal', 'money',
]);
const TEMPORAL_TYPES = new Set([
  'date', 'timestamp without time zone', 'timestamp with time zone',
]);

/** The dataset dimension type for an `information_schema` data type. */
export function postgresToDimensionType(dataType: string): GeneratedDimensionType {
  if (NUMERIC_TYPES.has(dataType)) return 'number';
  if (TEMPORAL_TYPES.has(dataType)) return 'timestamp';
  if (dataType === 'boolean') return 'boolean';
  // text, varchar, uuid, enums (USER-DEFINED), json and anything else.
  return 'string';
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A table in `public` keeps its name; any other schema prefixes it. */
function tableOf(schema: string, table: string): IntrospectedTable {
  return schema === 'public'
    ? { name: table, source: table }
    : { name: `${schema}_${table}`, source: `${schema}.${table}` };
}

/**
 * Introspect a Postgres database through its catalogs. Covers every
 * non-system schema the role can see; names that are not plain identifiers
 * cannot be dataset sources and are skipped.
 */
export function postgresIntrospector(client: PostgresIntrospectionClient): SchemaIntrospector {
  return {
    engine: 'Postgres',
    async listTables(): Promise<IntrospectedTable[]> {
      const { rows } = await client.query<{ table_schema: string; table_name: string }>(
        `SELECT table_schema, table_name FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg\\_%'
           AND table_type IN ('BASE TABLE', 'VIEW')
         ORDER BY table_schema = 'public' DESC, table_schema, table_name`,
      );
      return rows
        .filter((row) => IDENTIFIER.test(row.table_schema) && IDENTIFIER.test(row.table_name))
        .map((row) => tableOf(row.table_schema, row.table_name));
    },
    async describeTable(table: IntrospectedTable): Promise<IntrospectedColumn[]> {
      const [schema, name] = table.source.includes('.') ? table.source.split('.') : ['public', table.source];
      const { rows } = await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, name],
      );
      return rows
        .filter((row) => IDENTIFIER.test(row.column_name))
        .map((row) => ({
          name: row.column_name,
          type: row.data_type,
          dimensionType: postgresToDimensionType(row.data_type),
          numeric: NUMERIC_TYPES.has(row.data_type),
          temporal: TEMPORAL_TYPES.has(row.data_type),
        }));
    },
    async foreignKeys(tables: readonly IntrospectedTable[]): Promise<Map<string, IntrospectedForeignKey[]>> {
      // Single-column keys only: a composite key needs a hand-written relationship.
      const { rows } = await client.query<{
        source_schema: string; source_table: string; source_column: string;
        target_schema: string; target_table: string; target_column: string;
      }>(
        `SELECT sn.nspname AS source_schema, s.relname AS source_table, sa.attname AS source_column,
                tn.nspname AS target_schema, t.relname AS target_table, ta.attname AS target_column
         FROM pg_constraint c
         JOIN pg_class s ON s.oid = c.conrelid JOIN pg_namespace sn ON sn.oid = s.relnamespace
         JOIN pg_class t ON t.oid = c.confrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
         JOIN pg_attribute sa ON sa.attrelid = c.conrelid AND sa.attnum = c.conkey[1]
         JOIN pg_attribute ta ON ta.attrelid = c.confrelid AND ta.attnum = c.confkey[1]
         WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
         ORDER BY sn.nspname, s.relname, sa.attnum`,
      );
      const included = new Set(tables.map((table) => table.name));
      const keys = new Map<string, IntrospectedForeignKey[]>();
      for (const row of rows) {
        const source = tableOf(row.source_schema, row.source_table).name;
        const target = tableOf(row.target_schema, row.target_table).name;
        if (!included.has(source) || !included.has(target)) continue;
        if (!IDENTIFIER.test(row.source_column) || !IDENTIFIER.test(row.target_column)) continue;
        keys.set(source, [...(keys.get(source) ?? []), {
          column: row.source_column, target, targetColumn: row.target_column,
        }]);
      }
      return keys;
    },
  };
}

/** Connection URL for Postgres commands, from the environment. */
export function postgresUrlFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const url = env.HYPEQUERY_POSTGRES_URL || env.POSTGRES_URL || env.DATABASE_URL;
  return url && /^postgres(ql)?:\/\//.test(url) ? url : undefined;
}

/**
 * Run *work* with a connected node-postgres client. `pg` is loaded on demand
 * so ClickHouse-only commands never pay for it.
 */
export async function withPostgresClient<T>(
  url: string,
  work: (client: PostgresIntrospectionClient) => Promise<T>,
): Promise<T> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
