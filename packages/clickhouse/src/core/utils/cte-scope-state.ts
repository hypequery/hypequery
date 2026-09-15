import type { BuilderState, CteShapes, SchemaDefinition } from '../types/builder-state.js';

/** Concrete runtime metadata; result columns are carried by the public overloads. */
export type CteScopeRuntimeState<Schema extends SchemaDefinition<Schema>> = BuilderState<
  Schema, string, Record<string, unknown>, keyof Schema, {}, {}, Record<string, unknown>, CteShapes
>;

export function createCteScopeState<Schema extends SchemaDefinition<Schema>>(
  name: string,
): CteScopeRuntimeState<Schema> {
  return {
    // Schema definitions are type-only in createQueryBuilder, so no runtime
    // schema is available here either.
    schema: {} as Schema,
    tables: name,
    // BuilderState currently constrains baseTable to schema keys, even though
    // CTE names also serve as base sources. Keep that boundary explicit here.
    baseTable: name as keyof Schema,
    base: {},
    output: {},
    aliases: {},
    scalars: {},
    ctes: {},
  };
}
