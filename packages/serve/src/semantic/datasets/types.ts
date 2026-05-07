export type FieldType = 'string' | 'number' | 'boolean' | 'timestamp';
export type DimensionType = FieldType;

export interface DimensionOptions {
  label?: string;
  description?: string;
  column?: string;
  sql?: string;
  filterable?: boolean;
  groupable?: boolean;
}

export type FieldOptions = DimensionOptions;

export interface DimensionDefinition<TType extends DimensionType = DimensionType> {
  __type: 'field_definition';
  fieldType: TType;
  label?: string;
  description?: string;
  column?: string;
  sql?: string;
  filterable?: boolean;
  groupable?: boolean;
}

export type FieldDefinition<TType extends FieldType = FieldType> = DimensionDefinition<TType>;

export type InferFieldType<T extends FieldDefinition> =
  T['fieldType'] extends 'string' ? string :
  T['fieldType'] extends 'number' ? number :
  T['fieldType'] extends 'boolean' ? boolean :
  T['fieldType'] extends 'timestamp' ? string :
  never;

export type InferDimensionType<T extends DimensionDefinition> = InferFieldType<T>;

export type RelationshipKind = 'belongsTo' | 'hasMany' | 'hasOne';

export interface RelationshipDefinition {
  __type: 'relationship';
  kind: RelationshipKind;
  target: () => { __type: 'dataset'; name: string };
  from: string;
  to: string;
}

export type AggregationType = 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max';
export type MeasureAggregation = AggregationType;

export interface AggregationSpec {
  __type: 'aggregation_spec';
  aggregation: AggregationType;
  field: string;
}

export interface MeasureOptions {
  label?: string;
  description?: string;
}

export interface MeasureDefinition {
  __type: 'measure_definition';
  aggregation: MeasureAggregation;
  field: string;
  label?: string;
  description?: string;
}

export type FormulaExpr = {
  __type: 'formula_expr';
  toSQL: () => string;
};

export interface MetricRef<
  TDatasetName extends string = string,
  TMetricName extends string = string,
> {
  __type: 'metric_ref';
  datasetName: TDatasetName;
  name: TMetricName;
  spec: AggregationSpec | DerivedMetricSpec;
  label?: string;
  description?: string;
  dataset: DatasetInstance<any, any, any>;
  by(grain: TimeGrain): GrainedMetricRef<TDatasetName, TMetricName>;
  contract(): MetricContract;
}

export interface DerivedMetricSpec {
  __type: 'derived_metric_spec';
  uses: Record<string, MetricRef>;
  formula: (inputs: Record<string, string>) => FormulaExpr;
}

export interface GrainedMetricRef<
  TDatasetName extends string = string,
  TMetricName extends string = string,
> {
  __type: 'grained_metric_ref';
  metric: MetricRef<TDatasetName, TMetricName>;
  grain: TimeGrain;
  contract(): MetricContract;
}

export type MetricHandle<
  TDatasetName extends string = string,
  TMetricName extends string = string,
> = MetricRef<TDatasetName, TMetricName> | GrainedMetricRef<TDatasetName, TMetricName>;

export type TimeGrain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface MetricContract {
  kind: 'metric' | 'derived_metric' | 'grained_metric';
  name: string;
  dataset: string;
  valueType: 'number';
  label?: string;
  description?: string;
  dimensions: string[];
  measures?: string[];
  filters: string[];
  grains: TimeGrain[];
  grain?: TimeGrain;
  requires?: string[];
  tenantScoped: boolean;
}

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

export interface MetricResultMeta {
  timingMs?: number;
  sql?: string;
  tenant?: string;
}

export interface MetricResult<T = Record<string, unknown>> {
  data: T[];
  meta?: MetricResultMeta;
}

export interface ExecutionContext {
  tenantId?: string;
}

export interface SemanticFilterDefinition {
  __type: 'filter_definition';
  field: string;
  label?: string;
  description?: string;
  operators?: MetricFilter['operator'][];
}

export type SemanticFiltersDefinition = Record<string, SemanticFilterDefinition>;

export interface DatasetLimits {
  maxDimensions?: number;
  maxMeasures?: number;
  maxFilters?: number;
  maxResultSize?: number;
}

export interface BaseMetricConfig<
  TDimensions extends Record<string, DimensionDefinition> = Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, MeasureDefinition>,
> {
  value?: AggregationSpec;
  measure?: keyof TMeasures & string;
  label?: string;
  description?: string;
}

export interface DerivedMetricConfig {
  uses: Record<string, MetricRef>;
  formula: (inputs: Record<string, string>) => FormulaExpr;
  label?: string;
  description?: string;
}

export interface DatasetQueryConfig<
  TDimensions extends Record<string, DimensionDefinition> = Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, MeasureDefinition>,
> {
  dimensions?: Array<keyof TDimensions & string>;
  measures?: Array<keyof TMeasures & string>;
  filters?: MetricFilter[];
  orderBy?: MetricOrderBy[];
  limit?: number;
  offset?: number;
  by?: TimeGrain;
}

export interface DatasetQueryContract {
  dataset: string;
  dimensions: string[];
  measures: string[];
  filters: string[];
  grains: TimeGrain[];
  tenantScoped: boolean;
}

export interface DatasetQueryRef<
  TDimensions extends Record<string, DimensionDefinition> = Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, MeasureDefinition>,
> {
  __type: 'dataset_query_ref';
  dataset: DatasetInstance<TDimensions, TMeasures, any>;
  config: DatasetQueryConfig<TDimensions, TMeasures>;
  contract(): DatasetQueryContract;
}

export interface DatasetConfig<
  TDimensions extends Record<string, DimensionDefinition> = Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, MeasureDefinition>,
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, never>,
> {
  source: string;
  tenantKey?: string;
  timeKey?: string;
  dimensions?: TDimensions;
  fields?: TDimensions;
  measures?: TMeasures;
  filters?: SemanticFiltersDefinition;
  relationships?: TRelationships;
  limits?: DatasetLimits;
}

export interface DatasetInstance<
  TDimensions extends Record<string, DimensionDefinition> = Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, MeasureDefinition>,
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, never>,
> {
  __type: 'dataset';
  name: string;
  source: string;
  tenantKey?: string;
  timeKey?: string;
  dimensions: TDimensions;
  fields: TDimensions;
  measures: TMeasures;
  filters: SemanticFiltersDefinition;
  relationships: TRelationships;
  limits?: DatasetLimits;
  metric<TName extends string>(
    metricName: TName,
    metricConfig: BaseMetricConfig<TDimensions, TMeasures> | DerivedMetricConfig,
  ): MetricRef<string, TName>;
  query(config: DatasetQueryConfig<TDimensions, TMeasures>): DatasetQueryRef<TDimensions, TMeasures>;
}

export interface DatasetRegistryInstance {
  register(ds: DatasetInstance<any, any, any>): void;
  get(name: string): DatasetInstance<any, any, any> | undefined;
  getAll(): DatasetInstance<any, any, any>[];
  has(name: string): boolean;
}

export type DatasetFieldNames<TDataset extends DatasetInstance<any, any, any>> =
  keyof TDataset['dimensions'] & string;
