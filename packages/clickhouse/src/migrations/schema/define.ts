import type {
  ClickHouseMaterializedViewDefinition,
  ClickHouseMaterializedViewInputDefinition,
  ClickHouseSchemaAst,
  ClickHouseSchemaDefinition,
  ClickHouseTableDefinition,
  ClickHouseTableInputDefinition,
} from './types.js';

export function defineSchema(definition: ClickHouseSchemaDefinition): ClickHouseSchemaAst {
  return {
    tables: [...definition.tables],
    ...(definition.materializedViews !== undefined
      ? { materializedViews: [...definition.materializedViews] }
      : {}),
  };
}

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
