/**
 * Core types for the semantic layer: models, dimensions, measures, relationships, and datasets.
 *
 * These types are DB-agnostic — they describe the business logic layer
 * that sits between your schema and your API consumers.
 */

// ---------------------------------------------------------------------------
// Schema constraint
// ---------------------------------------------------------------------------

/**
 * A "resolved" schema: table names → column names → TypeScript types.
 * This is what users define (or what gets generated from introspection).
 * Deliberately DB-agnostic — no ClickHouse/Postgres type strings.
 */
export type SemanticSchema = Record<string, Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Dimension types
// ---------------------------------------------------------------------------

/** Semantic type of a dimension, used for UI hints and validation. */
export type DimensionType = 'string' | 'number' | 'boolean' | 'time';

/** Maps a semantic DimensionType to its TypeScript type. */
export type InferDimensionType<T extends DimensionType> =
  T extends 'string' ? string :
  T extends 'number' ? number :
  T extends 'boolean' ? boolean :
  T extends 'time' ? string :
  never;

/** Definition of a single dimension on a model. */
export interface DimensionDefinition<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string,
  TType extends DimensionType = DimensionType
> {
  /** The physical column this dimension maps to. Type-safe against the schema. */
  column: keyof TSchema[TTable] & string;
  /** Semantic type — determines how the dimension is presented and filtered. */
  type: TType;
  /** Human-readable label for UIs and docs. */
  label?: string;
  /** Longer description for documentation. */
  description?: string;
  /**
   * Custom SQL expression. When provided, this is used instead of the bare column name.
   * Useful for transformations like `LOWER(country)` or `toDate(created_at)`.
   */
  sql?: string;
}

/** A record of named dimensions for a model. */
export type DimensionsDefinition<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string
> = Record<string, DimensionDefinition<TSchema, TTable>>;

// ---------------------------------------------------------------------------
// Measure types
// ---------------------------------------------------------------------------

/** Supported aggregation functions for measures. */
export type MeasureAggregation = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'countDistinct';

/** Definition of a single measure on a model. */
export interface MeasureDefinition<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string
> {
  /** The physical column to aggregate. Type-safe against the schema. */
  column: keyof TSchema[TTable] & string;
  /** The aggregation function to apply. */
  type: MeasureAggregation;
  /** Human-readable label for UIs and docs. */
  label?: string;
  /** Longer description for documentation. */
  description?: string;
  /**
   * Custom SQL expression for the aggregation.
   * When provided, this replaces the default `type(column)` pattern.
   * Example: `"SUM(amount * quantity)"` or `"COUNT(DISTINCT user_id)"`.
   */
  sql?: string;
}

/** A record of named measures for a model. */
export type MeasuresDefinition<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string
> = Record<string, MeasureDefinition<TSchema, TTable>>;

// ---------------------------------------------------------------------------
// Relationship types
// ---------------------------------------------------------------------------

/** The cardinality of a relationship between models. */
export type RelationshipType = 'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany';

/** Definition of a relationship from one model to another. */
export interface RelationshipDefinition<
  TSchema extends SemanticSchema,
  TFromTable extends keyof TSchema & string
> {
  /**
   * Lazy reference to the target model. Use a thunk `() => TargetModel`
   * to avoid circular import issues between model files.
   */
  model: () => Model<TSchema, any, any, any, any>;
  /** Join condition: column on the current (source) model. */
  join: {
    from: keyof TSchema[TFromTable] & string;
    to: string; // column on the target model — validated at runtime
  };
  /** Cardinality of the relationship. */
  type: RelationshipType;
}

/** A record of named relationships for a model. */
export type RelationshipsDefinition<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string
> = Record<string, RelationshipDefinition<TSchema, TTable>>;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** Configuration object passed to `defineModel`. */
export interface ModelConfig<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string,
  TDimensions extends DimensionsDefinition<TSchema, TTable>,
  TMeasures extends MeasuresDefinition<TSchema, TTable>,
  TRelationships extends RelationshipsDefinition<TSchema, TTable>
> {
  /** The physical table name. Must exist in the schema. */
  table: TTable;
  /** Human-readable label for the model. */
  label?: string;
  /** Longer description for documentation. */
  description?: string;
  /** Named dimensions (columns exposed as groupable/filterable fields). */
  dimensions: TDimensions;
  /** Named measures (aggregations exposed as metric fields). */
  measures: TMeasures;
  /** Named relationships to other models. */
  relationships?: TRelationships;
}

/** A fully defined model — the return type of `defineModel`. */
export interface Model<
  TSchema extends SemanticSchema,
  TTable extends keyof TSchema & string,
  TDimensions extends DimensionsDefinition<TSchema, TTable>,
  TMeasures extends MeasuresDefinition<TSchema, TTable>,
  TRelationships extends RelationshipsDefinition<TSchema, TTable>
> {
  readonly __type: 'semantic_model';
  readonly table: TTable;
  readonly label?: string;
  readonly description?: string;
  readonly dimensions: TDimensions;
  readonly measures: TMeasures;
  readonly relationships: TRelationships;
}

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

/** A map of named models, passed to `defineServe({ models: { ... } })`. */
export type ModelRegistry<TSchema extends SemanticSchema = SemanticSchema> =
  Record<string, Model<TSchema, any, any, any, any>>;

// ---------------------------------------------------------------------------
// Dataset filter types
// ---------------------------------------------------------------------------

/** A filter condition applied to a dataset query. */
export interface DatasetFilter {
  /** Dimension name (or `relationship.dimension` for cross-model). */
  dimension: string;
  /** Filter operator. */
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between' | 'like' | 'notLike';
  /** Filter value — type depends on the operator. */
  value: unknown;
}

/** Sort specification for a dataset query. */
export interface DatasetOrderBy {
  /** Dimension or measure name to sort by. */
  field: string;
  /** Sort direction. */
  direction: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Dataset configuration (the "resolved" query spec)
// ---------------------------------------------------------------------------

/**
 * The configuration for a dataset query — a serializable description of
 * which dimensions, measures, filters, and sorts to apply.
 *
 * This is what gets built by the dataset fluent API, and what could also
 * be sent over the wire from a dashboard UI.
 */
export interface DatasetConfig {
  /** The model name (key in the model registry). */
  model: string;
  /** Dimension names to select (from the model). */
  dimensions: string[];
  /** Measure names to select (from the model). */
  measures: string[];
  /** Cross-model includes: pull dimensions/measures through relationships. */
  include?: DatasetInclude[];
  /** Filters to apply. */
  filters?: DatasetFilter[];
  /** Sort order. */
  orderBy?: DatasetOrderBy[];
  /** Max rows. */
  limit?: number;
  /** Row offset. */
  offset?: number;
}

/** Cross-model include: select fields through a relationship. */
export interface DatasetInclude {
  /** Relationship name on the base model. */
  through: string;
  /** Dimension names from the related model. */
  dimensions?: string[];
  /** Measure names from the related model. */
  measures?: string[];
}

// ---------------------------------------------------------------------------
// Result type inference
// ---------------------------------------------------------------------------

/**
 * Infer the output row type from a model's dimensions.
 * Given selected dimension keys, produces `{ [key]: InferDimensionType<type> }`.
 */
export type InferDimensionRow<
  TDimensions extends Record<string, { type: DimensionType }>,
  TKeys extends keyof TDimensions
> = {
  [K in TKeys]: InferDimensionType<TDimensions[K]['type']>;
};

/**
 * Infer the output row type from a model's measures.
 * All measures resolve to `number` in the result.
 */
export type InferMeasureRow<
  TMeasures extends Record<string, unknown>,
  TKeys extends keyof TMeasures
> = {
  [K in TKeys]: number;
};

/**
 * Combine dimension + measure row types into a single result row.
 */
export type InferDatasetRow<
  TDimensions extends Record<string, { type: DimensionType }>,
  TDimKeys extends keyof TDimensions,
  TMeasures extends Record<string, unknown>,
  TMeasureKeys extends keyof TMeasures
> = InferDimensionRow<TDimensions, TDimKeys> & InferMeasureRow<TMeasures, TMeasureKeys>;
