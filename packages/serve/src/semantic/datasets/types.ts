/**
 * Types for the Dataset & Metrics API (v2).
 *
 * Datasets are typed data contracts over physical tables. Metrics are
 * dataset-attached aggregations — canonical, reusable business values.
 */

// =============================================================================
// FIELD TYPES
// =============================================================================

/** Semantic type of a field. */
export type FieldType = 'string' | 'number' | 'boolean' | 'timestamp';

/** Options for field helpers. */
export interface FieldOptions {
  label?: string;
  description?: string;
}

/** A field definition — lightweight type marker with optional metadata. */
export interface FieldDefinition<T extends FieldType = FieldType> {
  readonly __type: 'field_definition';
  readonly fieldType: T;
  readonly label?: string;
  readonly description?: string;
}

/** Maps a FieldType to its TypeScript type. */
export type InferFieldType<T extends FieldType> =
  T extends 'string' ? string :
  T extends 'number' ? number :
  T extends 'boolean' ? boolean :
  T extends 'timestamp' ? string :
  never;

// =============================================================================
// RELATIONSHIP TYPES
// =============================================================================

export type RelationshipKind = 'belongsTo' | 'hasMany' | 'hasOne';

export interface RelationshipDefinition {
  readonly __type: 'relationship';
  readonly kind: RelationshipKind;
  readonly target: () => DatasetInstance<any>;
  readonly from: string;
  readonly to: string;
}

// =============================================================================
// AGGREGATION TYPES
// =============================================================================

export type AggregationType = 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max';

/** Aggregation spec — what `sum("amount")` returns. */
export interface AggregationSpec {
  readonly __type: 'aggregation_spec';
  readonly aggregation: AggregationType;
  readonly field: string;
}

// =============================================================================
// FORMULA TYPES
// =============================================================================

/** A symbolic formula expression — not raw SQL, compiled later. */
export interface FormulaExpr {
  readonly __type: 'formula_expr';
  toSQL(): string;
}

/** Spec for a derived metric — uses base metrics + formula. */
export interface DerivedMetricSpec {
  readonly __type: 'derived_metric_spec';
  readonly uses: Record<string, MetricRef<any, any>>;
  readonly formula: (refs: Record<string, string>) => FormulaExpr;
}

// =============================================================================
// TIME GRAIN TYPES
// =============================================================================

export type TimeGrain = 'day' | 'week' | 'month' | 'quarter' | 'year';

// =============================================================================
// METRIC REF
// =============================================================================

/** A lightweight, serializable handle to a metric. */
export interface MetricRef<
  TDatasetName extends string = string,
  TName extends string = string,
> {
  readonly __type: 'metric_ref';
  readonly datasetName: TDatasetName;
  readonly name: TName;
  readonly spec: AggregationSpec | DerivedMetricSpec;
  readonly label?: string;
  readonly description?: string;
  readonly dataset: DatasetInstance<any>;

  /** Time grain operator — returns a grained metric ref. */
  by(grain: TimeGrain): GrainedMetricRef<TDatasetName, TName>;

  /** Get the metric's contract for introspection. */
  contract(): MetricContract;
}

/** A metric with a time grain applied. */
export interface GrainedMetricRef<
  TDatasetName extends string = string,
  TName extends string = string,
> {
  readonly __type: 'grained_metric_ref';
  readonly metric: MetricRef<TDatasetName, TName>;
  readonly grain: TimeGrain;

  /** Get the grained metric's contract. */
  contract(): MetricContract;
}

// =============================================================================
// METRIC CONTRACT
// =============================================================================

export interface MetricContract {
  kind: 'metric' | 'derived_metric' | 'grained_metric';
  name: string;
  dataset: string;
  valueType: 'number';
  label?: string;
  description?: string;
  dimensions: string[];
  filters: string[];
  grains: TimeGrain[];
  grain?: TimeGrain;
  requires?: string[];
  tenantScoped: boolean;
}

// =============================================================================
// METRIC QUERY
// =============================================================================

export interface MetricFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between' | 'like';
  value: unknown;
}

export interface MetricOrderBy {
  field: string;
  direction: 'asc' | 'desc';
}

export interface MetricQuery {
  dimensions?: string[];
  filters?: MetricFilter[];
  orderBy?: MetricOrderBy[];
  limit?: number;
  offset?: number;
  by?: TimeGrain;
}

// =============================================================================
// METRIC RESULT
// =============================================================================

export interface MetricResultMeta {
  cache?: { hit: boolean; key?: string };
  timingMs?: number;
  traceId?: string;
  sql?: string;
  tenant?: string;
}

export interface MetricResult<T = Record<string, unknown>> {
  data: T[];
  meta: MetricResultMeta;
}

// =============================================================================
// EXECUTION CONTEXT
// =============================================================================

export interface ExecutionContext {
  tenantId?: string;
}

// =============================================================================
// DATASET DEFINITION
// =============================================================================

/** The config object passed to `dataset()`. */
export interface DatasetConfig<
  TFields extends Record<string, FieldDefinition> = Record<string, FieldDefinition>,
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, RelationshipDefinition>,
> {
  source: string;
  tenantKey?: string;
  timeKey?: string;
  fields: TFields;
  relationships?: TRelationships;
  limits?: DatasetLimits;
}

export interface DatasetLimits {
  maxDimensions?: number;
  maxFilters?: number;
  maxResultSize?: number;
}

/** A dataset instance — returned by `dataset()`. Has a `.metric()` method. */
export interface DatasetInstance<
  TFields extends Record<string, FieldDefinition> = Record<string, FieldDefinition>,
> {
  readonly __type: 'dataset';
  readonly name: string;
  readonly source: string;
  readonly tenantKey?: string;
  readonly timeKey?: string;
  readonly fields: TFields;
  readonly relationships: Record<string, RelationshipDefinition>;
  readonly limits?: DatasetLimits;

  /** Define a base metric on this dataset. */
  metric<TName extends string>(
    name: TName,
    config: BaseMetricConfig<TFields>,
  ): MetricRef<string, TName>;

  /** Define a derived metric on this dataset. */
  metric<TName extends string>(
    name: TName,
    config: DerivedMetricConfig,
  ): MetricRef<string, TName>;
}

/** Config for a base metric (has `value`). */
export interface BaseMetricConfig<
  TFields extends Record<string, FieldDefinition> = Record<string, FieldDefinition>,
> {
  value: AggregationSpec;
  label?: string;
  description?: string;
}

/** Config for a derived metric (has `uses` + `formula`). */
export interface DerivedMetricConfig {
  uses: Record<string, MetricRef<any, any>>;
  formula: (refs: Record<string, string>) => FormulaExpr;
  label?: string;
  description?: string;
}

// =============================================================================
// DATASET REGISTRY
// =============================================================================

export interface DatasetRegistryInstance {
  register(ds: DatasetInstance<any>): void;
  get(name: string): DatasetInstance<any> | undefined;
  getAll(): DatasetInstance<any>[];
  has(name: string): boolean;
}

// =============================================================================
// TYPE INFERENCE
// =============================================================================

/** Extract field names from a DatasetInstance. */
export type DatasetFieldNames<T extends DatasetInstance<any>> =
  T extends DatasetInstance<infer F> ? Extract<keyof F, string> : never;
