/**
 * defineModel — creates a type-safe semantic model over a physical table.
 */

import type {
  SemanticSchema,
  DimensionsDefinition,
  MeasuresDefinition,
  RelationshipsDefinition,
  ModelConfig,
  Model,
} from './types.js';

/**
 * Define a semantic model for a table in your schema.
 *
 * Models describe the business-level view of a table: which columns are
 * dimensions (groupable/filterable), which are measures (aggregatable),
 * and how this table relates to others.
 *
 * @example
 * ```ts
 * const OrderModel = defineModel<MySchema, 'orders'>()({
 *   table: 'orders',
 *   label: 'Orders',
 *   dimensions: {
 *     country: { column: 'country', type: 'string', label: 'Country' },
 *     status:  { column: 'status',  type: 'string', label: 'Order Status' },
 *     created: { column: 'created_at', type: 'time', label: 'Created At' },
 *   },
 *   measures: {
 *     revenue:    { column: 'amount', type: 'sum',   label: 'Total Revenue' },
 *     orderCount: { column: 'id',     type: 'count', label: 'Order Count' },
 *   },
 *   relationships: {
 *     customer: {
 *       model: () => CustomerModel,
 *       join: { from: 'user_id', to: 'id' },
 *       type: 'manyToOne',
 *     },
 *   },
 * });
 * ```
 */
export function defineModel<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string
>() {
  return <
    TDimensions extends DimensionsDefinition<TSchema, TTable>,
    TMeasures extends MeasuresDefinition<TSchema, TTable>,
    TRelationships extends RelationshipsDefinition<TSchema, TTable> = {}
  >(
    config: ModelConfig<TSchema, TTable, TDimensions, TMeasures, TRelationships>
  ): Model<TSchema, TTable, TDimensions, TMeasures, TRelationships> => {
    return {
      __type: 'semantic_model' as const,
      table: config.table,
      label: config.label,
      description: config.description,
      dimensions: config.dimensions,
      measures: config.measures,
      relationships: (config.relationships ?? {}) as TRelationships,
    };
  };
}
