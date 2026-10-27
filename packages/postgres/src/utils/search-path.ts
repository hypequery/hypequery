import { quotePostgresIdentifier } from './identifiers.js';

/**
 * The `search_path` value that pins name resolution to *schemas*.
 *
 * `pg_catalog` comes first, so a function with a built-in's exact signature in
 * a listed schema can't replace the built-in, and `pg_temp` comes last, so a
 * temporary table can't shadow a source table. Postgres still weighs
 * overloads with other argument types from every listed schema, so list only
 * schemas that untrusted roles cannot create objects in.
 */
export function pinnedSearchPath(schemas: readonly string[]): string {
  for (const schema of schemas) {
    if (typeof schema !== 'string' || schema.length === 0 || schema.includes('\0')) {
      throw new Error('searchPath must list non-empty schema names.');
    }
    if (schema === 'pg_catalog' || schema === 'pg_temp') {
      throw new Error(`searchPath must not list ${schema}; it is placed automatically.`);
    }
  }
  return ['pg_catalog', ...schemas.map(quotePostgresIdentifier), 'pg_temp'].join(', ');
}
