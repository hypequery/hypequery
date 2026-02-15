/**
 * Dataset builder — fluent API for constructing type-safe queries from semantic models.
 *
 * Builds a DatasetConfig (serializable query spec) and infers the result row type
 * from the selected dimensions and measures. Execution is handled separately by
 * the database adapter.
 */

import type {
  SemanticSchema,
  DimensionsDefinition,
  MeasuresDefinition,
  RelationshipsDefinition,
  Model,
  ModelRegistry,
  DatasetConfig,
  DatasetFilter,
  DatasetOrderBy,
  DatasetInclude,
  DimensionType,
  InferDimensionRow,
  InferMeasureRow,
} from './types.js';

// ---------------------------------------------------------------------------
// Dataset builder state — tracks selected fields at the type level
// ---------------------------------------------------------------------------

interface DatasetBuilderState<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string,
  TDimensions extends DimensionsDefinition<TSchema, TTable>,
  TMeasures extends MeasuresDefinition<TSchema, TTable>,
  TRelationships extends RelationshipsDefinition<TSchema, TTable>,
  TSelectedDims extends keyof TDimensions,
  TSelectedMeasures extends keyof TMeasures
> {
  model: Model<TSchema, TTable, TDimensions, TMeasures, TRelationships>;
  dimensions: TSelectedDims[];
  measures: TSelectedMeasures[];
  includes: DatasetInclude[];
  filters: DatasetFilter[];
  orderBy: DatasetOrderBy[];
  limit?: number;
  offset?: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// The dataset builder (fluent API)
// ---------------------------------------------------------------------------

export interface DatasetBuilder<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string,
  TDimensions extends DimensionsDefinition<TSchema, TTable>,
  TMeasures extends MeasuresDefinition<TSchema, TTable>,
  TRelationships extends RelationshipsDefinition<TSchema, TTable>,
  TSelectedDims extends keyof TDimensions,
  TSelectedMeasures extends keyof TMeasures
> {
  /** Select dimensions to group by. */
  dimensions<K extends keyof TDimensions>(
    dims: K[]
  ): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims | K, TSelectedMeasures>;

  /** Select measures to aggregate. */
  measures<K extends keyof TMeasures>(
    measures: K[]
  ): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures | K>;

  /** Include dimensions/measures from a related model via a relationship. */
  include(
    includes: Array<{
      through: Extract<keyof TRelationships, string>;
      dimensions?: string[];
      measures?: string[];
    }>
  ): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures>;

  /** Add filters. Dimension names are type-checked against the model. */
  filter(
    filters: Array<{
      dimension: Extract<keyof TDimensions, string> | (string & {});
      operator: DatasetFilter['operator'];
      value: unknown;
    }>
  ): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures>;

  /** Set sort order. Field names are type-checked against selected dimensions and measures. */
  orderBy(
    specs: Array<{
      field: Extract<TSelectedDims, string> | Extract<TSelectedMeasures, string> | (string & {});
      direction: 'asc' | 'desc';
    }>
  ): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures>;

  /** Limit the number of rows returned. */
  limit(n: number): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures>;

  /** Offset for pagination. */
  offset(n: number): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures>;

  /** Add a description (shows up in OpenAPI docs). */
  describe(description: string): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures>;

  /** Get the serializable dataset configuration. */
  toConfig(): DatasetConfig;

  /**
   * Get the inferred result row type.
   * This is a phantom method — it exists only for type inference.
   * Use it with `typeof` or `ReturnType` to extract the row type.
   */
  readonly _outputType: InferDimensionRow<
    Pick<TDimensions, TSelectedDims & keyof TDimensions>,
    TSelectedDims & keyof TDimensions
  > & InferMeasureRow<
    Pick<TMeasures, TSelectedMeasures & keyof TMeasures>,
    TSelectedMeasures & keyof TMeasures
  >;
}

// ---------------------------------------------------------------------------
// Infer the result type from a DatasetBuilder
// ---------------------------------------------------------------------------

/** Extract the result row type from a DatasetBuilder instance. */
export type InferDatasetResult<T> = T extends DatasetBuilder<any, any, any, any, any, any, any>
  ? T['_outputType']
  : never;

// ---------------------------------------------------------------------------
// Builder implementation
// ---------------------------------------------------------------------------

function createDatasetBuilder<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string,
  TDimensions extends DimensionsDefinition<TSchema, TTable>,
  TMeasures extends MeasuresDefinition<TSchema, TTable>,
  TRelationships extends RelationshipsDefinition<TSchema, TTable>,
  TSelectedDims extends keyof TDimensions,
  TSelectedMeasures extends keyof TMeasures
>(
  state: DatasetBuilderState<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures>
): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, TSelectedDims, TSelectedMeasures> {
  return {
    dimensions(dims) {
      return createDatasetBuilder({
        ...state,
        dimensions: [...state.dimensions, ...dims] as any,
      }) as any;
    },

    measures(measures) {
      return createDatasetBuilder({
        ...state,
        measures: [...state.measures, ...measures] as any,
      }) as any;
    },

    include(includes) {
      return createDatasetBuilder({
        ...state,
        includes: [
          ...state.includes,
          ...includes.map((inc) => ({
            through: inc.through,
            dimensions: inc.dimensions,
            measures: inc.measures,
          })),
        ],
      }) as any;
    },

    filter(filters) {
      return createDatasetBuilder({
        ...state,
        filters: [
          ...state.filters,
          ...filters.map((f) => ({
            dimension: f.dimension as string,
            operator: f.operator,
            value: f.value,
          })),
        ],
      }) as any;
    },

    orderBy(specs) {
      return createDatasetBuilder({
        ...state,
        orderBy: [...state.orderBy, ...specs],
      }) as any;
    },

    limit(n) {
      return createDatasetBuilder({ ...state, limit: n }) as any;
    },

    offset(n) {
      return createDatasetBuilder({ ...state, offset: n }) as any;
    },

    describe(description) {
      return createDatasetBuilder({ ...state, description }) as any;
    },

    toConfig(): DatasetConfig {
      return {
        model: state.model.table,
        dimensions: state.dimensions as string[],
        measures: state.measures as string[],
        include: state.includes.length > 0 ? state.includes : undefined,
        filters: state.filters.length > 0 ? state.filters : undefined,
        orderBy: state.orderBy.length > 0 ? state.orderBy : undefined,
        limit: state.limit,
        offset: state.offset,
      };
    },

    get _outputType(): any {
      throw new Error(
        '_outputType is a phantom property for type inference only. ' +
        'Use `InferDatasetResult<typeof myDataset>` to extract the row type.'
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Public API: `dataset(model)` — entry point for building a dataset query
// ---------------------------------------------------------------------------

/**
 * Create a dataset builder from a model.
 *
 * @example
 * ```ts
 * const revenueByCountry = dataset(OrderModel)
 *   .dimensions(['country', 'status'])
 *   .measures(['revenue', 'orderCount'])
 *   .filter([{ dimension: 'status', operator: 'eq', value: 'completed' }])
 *   .orderBy([{ field: 'revenue', direction: 'desc' }])
 *   .limit(100);
 *
 * // Extract the result type
 * type Row = InferDatasetResult<typeof revenueByCountry>;
 * // ^? { country: string; status: string; revenue: number; orderCount: number }
 *
 * // Get the serializable config
 * const config = revenueByCountry.toConfig();
 * ```
 */
export function dataset<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string,
  TDimensions extends DimensionsDefinition<TSchema, TTable>,
  TMeasures extends MeasuresDefinition<TSchema, TTable>,
  TRelationships extends RelationshipsDefinition<TSchema, TTable>
>(
  model: Model<TSchema, TTable, TDimensions, TMeasures, TRelationships>
): DatasetBuilder<TSchema, TTable, TDimensions, TMeasures, TRelationships, never, never> {
  return createDatasetBuilder({
    model,
    dimensions: [],
    measures: [],
    includes: [],
    filters: [],
    orderBy: [],
  });
}
