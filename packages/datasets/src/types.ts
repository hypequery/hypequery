import type { SemanticExpression } from './semantic-plan.js';

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

export type InferDimensionType<T extends DimensionDefinition> =
  T['fieldType'] extends 'string' ? string :
  T['fieldType'] extends 'number' ? number :
  T['fieldType'] extends 'boolean' ? boolean :
  T['fieldType'] extends 'timestamp' ? string :
  never;

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
  filters?: MetricFilter[];
}

export interface MeasureOptions {
  sql?: string;
  label?: string;
  description?: string;
  filters?: MetricFilter[];
}

export interface MeasureDefinition {
  __type: 'measure_definition';
  aggregation: MeasureAggregation;
  field: string;
  sql?: string;
  label?: string;
  description?: string;
  filters?: MetricFilter[];
}

export type FormulaExpr = {
  __type: 'formula_expr';
  expression: SemanticExpression;
};

export interface DerivedMetricSpec<TDatasetName extends string = string> {
  __type: 'derived_metric_spec';
  uses: Record<string, BaseMetricRef<TDatasetName>>;
  formula: (inputs: Record<string, string>) => FormulaExpr;
}

export interface MetricRef<
  TDatasetName extends string = string,
  TMetricName extends string = string,
  TSpec extends AggregationSpec | DerivedMetricSpec<TDatasetName> = AggregationSpec | DerivedMetricSpec<TDatasetName>,
> {
  __type: 'metric_ref';
  datasetName: TDatasetName;
  name: TMetricName;
  spec: TSpec;
  label?: string;
  description?: string;
  dataset: DatasetInstance<
    Record<string, DimensionDefinition>,
    Record<string, MeasureDefinition>,
    Record<string, RelationshipDefinition>,
    TDatasetName
  >;
  by(grain: TimeGrain): GrainedMetricRef<TDatasetName, TMetricName, TSpec>;
  contract(): MetricContract;
}

export type BaseMetricRef<
  TDatasetName extends string = string,
  TMetricName extends string = string,
> = MetricRef<TDatasetName, TMetricName, AggregationSpec>;

export type DerivedMetricRef<
  TDatasetName extends string = string,
  TMetricName extends string = string,
> = MetricRef<TDatasetName, TMetricName, DerivedMetricSpec<TDatasetName>>;

export interface GrainedMetricRef<
  TDatasetName extends string = string,
  TMetricName extends string = string,
  TSpec extends AggregationSpec | DerivedMetricSpec<TDatasetName> = AggregationSpec | DerivedMetricSpec<TDatasetName>,
> {
  __type: 'grained_metric_ref';
  metric: MetricRef<TDatasetName, TMetricName, TSpec>;
  grain: TimeGrain;
  contract(): MetricContract;
}

export type MetricHandle<
  TDatasetName extends string = string,
  TMetricName extends string = string,
  TSpec extends AggregationSpec | DerivedMetricSpec<TDatasetName> = AggregationSpec | DerivedMetricSpec<TDatasetName>,
> = MetricRef<TDatasetName, TMetricName, TSpec> | GrainedMetricRef<TDatasetName, TMetricName, TSpec>;

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

export interface MetricFilter<
  TField extends string = string,
  TValue = unknown,
> {
  field: TField;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between' | 'like';
  value: TValue;
}

export interface MetricOrderBy<TField extends string = string> {
  field: TField;
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

export interface DatasetQuery {
  dimensions?: string[];
  measures?: string[];
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

export interface DatasetQueryResult<T = Record<string, unknown>> {
  data: T[];
  meta?: MetricResultMeta;
}

export interface SemanticTenantRuntime {
  id: string;
  column?: string;
}

export interface SemanticExecutionRuntime {
  tenant?: SemanticTenantRuntime;
}

export interface ExecutionContext {
  runtime?: SemanticExecutionRuntime;
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
  measure: keyof TMeasures & string;
  label?: string;
  description?: string;
}

export interface DerivedMetricConfig<TDatasetName extends string = string> {
  uses: Record<string, BaseMetricRef<TDatasetName>>;
  formula: (inputs: Record<string, string>) => FormulaExpr;
  label?: string;
  description?: string;
}

export interface DatasetConfig<
  TDimensions extends Record<string, DimensionDefinition> = Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, MeasureDefinition>,
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, never>,
> {
  source: string;
  tenantKey?: string;
  timeKey?: string;
  dimensions: TDimensions;
  measures?: TMeasures;
  filters?: SemanticFiltersDefinition;
  relationships?: TRelationships;
  limits?: DatasetLimits;
}

export interface DatasetInstance<
  TDimensions extends Record<string, DimensionDefinition> = Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, MeasureDefinition>,
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, never>,
  TDatasetName extends string = string,
> {
  __type: 'dataset';
  name: TDatasetName;
  source: string;
  tenantKey?: string;
  timeKey?: string;
  dimensions: TDimensions;
  measures: TMeasures;
  filters: SemanticFiltersDefinition;
  relationships: TRelationships;
  limits?: DatasetLimits;
  metric<TName extends string>(
    metricName: TName,
    metricConfig: BaseMetricConfig<TDimensions, TMeasures>,
  ): BaseMetricRef<TDatasetName, TName>;
  metric<TName extends string>(
    metricName: TName,
    metricConfig: DerivedMetricConfig<TDatasetName>,
  ): DerivedMetricRef<TDatasetName, TName>;
}

export interface DatasetRegistryInstance {
  register(ds: DatasetInstance): void;
  get(name: string): DatasetInstance | undefined;
  getAll(): DatasetInstance[];
  has(name: string): boolean;
}

export type AnyDatasetInstance = DatasetInstance<
  Record<string, DimensionDefinition>,
  Record<string, MeasureDefinition>,
  Record<string, RelationshipDefinition>,
  string
>;

export type DatasetFieldNames<TDataset extends DatasetInstance> =
  keyof TDataset['dimensions'] & string;
