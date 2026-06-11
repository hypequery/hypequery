import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';
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
  toSQL: () => string;
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

export type SemanticTenantRuntime =
  | string
  | { id: string }
  | { in: string[] }
  | { scope: 'all' };

export interface SemanticExecutionRuntime {
  builderFactory?: QueryBuilderFactoryLike;
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
    metricConfig: BaseMetricConfig<TMeasures>,
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

export type DatasetFieldNames<TDataset extends DatasetInstance<any, any, any, any>> =
  keyof TDataset['dimensions'] & string;

// ---------------------------------------------------------------------------
// Typed query / result helpers for client codegen and React hooks
//
// These constrain a query's dimension/measure/orderBy fields to the names a
// dataset or metric actually declares, and describe a best-effort typed result
// row. Filter fields stay `string` because a dataset's `filters` map is widened
// to `SemanticFiltersDefinition` and does not preserve literal keys.
// ---------------------------------------------------------------------------

/** Dimension names declared by a dataset. */
export type DatasetDimensionNames<TDataset extends DatasetInstance<any, any, any, any>> =
  keyof TDataset['dimensions'] & string;

/** Measure names declared by a dataset. */
export type DatasetMeasureNames<TDataset extends DatasetInstance<any, any, any, any>> =
  keyof TDataset['measures'] & string;

/**
 * Fields a result can be ordered by. This is the selection-independent superset
 * (every dimension + measure, plus the synthetic `period` column for grained
 * queries); the runtime validator additionally requires the field to be selected.
 */
export type DatasetOrderableNames<TDataset extends DatasetInstance<any, any, any, any>> =
  | DatasetDimensionNames<TDataset>
  | DatasetMeasureNames<TDataset>
  | 'period';

/** A dataset query whose fields are constrained to the dataset's contract. */
export interface DatasetQueryFor<TDataset extends DatasetInstance<any, any, any, any>> {
  dimensions?: DatasetDimensionNames<TDataset>[];
  measures?: DatasetMeasureNames<TDataset>[];
  filters?: MetricFilter[];
  orderBy?: MetricOrderBy<DatasetOrderableNames<TDataset>>[];
  limit?: number;
  offset?: number;
  by?: TimeGrain;
}

/** A best-effort typed result row for a dataset query. */
export type DatasetRow<TDataset extends DatasetInstance<any, any, any, any>> =
  & { [K in DatasetDimensionNames<TDataset>]?: InferDimensionType<TDataset['dimensions'][K]> }
  & { [K in DatasetMeasureNames<TDataset>]?: number }
  & { period?: string };

export interface DatasetQueryResultFor<TDataset extends DatasetInstance<any, any, any, any>> {
  data: DatasetRow<TDataset>[];
  meta?: MetricResultMeta;
}

/** A metric query whose fields are constrained to the metric's dataset + value column. */
export interface MetricQueryFor<
  TDataset extends DatasetInstance<any, any, any, any>,
  TMetricName extends string,
> {
  dimensions?: DatasetDimensionNames<TDataset>[];
  filters?: MetricFilter[];
  orderBy?: MetricOrderBy<DatasetDimensionNames<TDataset> | TMetricName | 'period'>[];
  limit?: number;
  offset?: number;
  by?: TimeGrain;
}

/** A best-effort typed result row for a metric query (dimensions + the metric value). */
export type MetricRow<
  TDataset extends DatasetInstance<any, any, any, any>,
  TMetricName extends string,
> =
  & { [K in DatasetDimensionNames<TDataset>]?: InferDimensionType<TDataset['dimensions'][K]> }
  & { [K in TMetricName]?: number }
  & { period?: string };

export interface MetricResultFor<
  TDataset extends DatasetInstance<any, any, any, any>,
  TMetricName extends string,
> {
  data: MetricRow<TDataset, TMetricName>[];
  meta?: MetricResultMeta;
}
