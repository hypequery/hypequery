import type {
  ClickHouseMaterializedViewDefinition,
  ClickHouseMaterializedViewInputDefinition,
  ClickHouseSchemaAst,
  ClickHouseSchemaDefinition,
  ClickHouseTableDefinition,
  ClickHouseTableInputDefinition,
} from './types.js';

/**
 * Creates a schema AST from the tables and materialized views declared in code.
 *
 * The returned AST is intentionally not SQL yet. It is serialized into a stable
 * snapshot first, then diffed against a previous snapshot to generate migrations.
 */
export function defineSchema(definition: ClickHouseSchemaDefinition): ClickHouseSchemaAst {
  return {
    tables: [...definition.tables],
    ...(definition.materializedViews !== undefined
      ? { materializedViews: [...definition.materializedViews] }
      : {}),
  };
}

/**
 * Defines a ClickHouse table for the migration DSL.
 *
 * Column builders are keyed by their final column names, which keeps the schema
 * definition compact while preserving enough structure for snapshot diffing.
 */
export function defineTable(
  name: string,
  definition: ClickHouseTableInputDefinition,
): ClickHouseTableDefinition {
  return {
    kind: 'table',
    name,
    columns: Object.entries(definition.columns).map(([columnName, builder]) => builder.build(columnName)),
    engine: definition.engine,
    ...(definition.settings !== undefined ? { settings: definition.settings } : {}),
  };
}

/**
 * Defines a ClickHouse materialized view and records its source-table dependency.
 *
 * The `from` and `to` fields may reference table definitions directly or use table
 * names. Dependencies are used by the renderer to drop and recreate views around
 * table mutations that could otherwise break stored SELECT definitions.
 */
export function defineMaterializedView(
  name: string,
  definition: ClickHouseMaterializedViewInputDefinition,
): ClickHouseMaterializedViewDefinition {
  return {
    kind: 'materialized_view',
    name,
    from: typeof definition.from === 'string' ? definition.from : definition.from.name,
    ...(definition.to !== undefined
      ? { to: typeof definition.to === 'string' ? definition.to : definition.to.name }
      : {}),
    select: definition.select,
  };
}
