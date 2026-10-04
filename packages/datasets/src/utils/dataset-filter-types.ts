import type {
  DatasetInstance,
  DimensionDefinition,
  MetricFilter,
  MetricFilterOperator,
  RelationshipDefinition,
  SemanticFilterDefinition,
  SemanticFiltersDefinition,
} from '../types.js';

/** The generated allowlist mirrors normalizeFilters; explicit maps replace it. */
export type NormalizedDatasetFilters<
  TDimensions extends Record<string, DimensionDefinition>,
  TFilters extends SemanticFiltersDefinition | undefined,
> = TFilters extends SemanticFiltersDefinition ? TFilters : {
  [K in keyof TDimensions as TDimensions[K] extends { filterable: false } ? never : K]: SemanticFilterDefinition & {
    field: K & string;
  };
};

type FilterOperators<TDefinition> = TDefinition extends {
  operators: readonly (infer TOperator extends MetricFilterOperator)[];
} ? TOperator : MetricFilterOperator;

type LocalFilterFor<TFilters extends SemanticFiltersDefinition> = {
  [K in keyof TFilters & string]: K extends `${string}.${string}`
    ? never
    : MetricFilter<K, unknown, FilterOperators<TFilters[K]>>;
}[keyof TFilters & string];

type RelationshipFilterFor<TRelationships extends Record<string, RelationshipDefinition>> = {
  [R in keyof TRelationships & string]: TRelationships[R] extends RelationshipDefinition<infer TTarget, infer TKind>
    ? TKind extends 'hasMany' ? never
      : TTarget extends DatasetInstance<any, any, any, any>
        ? {
          [K in keyof TTarget['filters'] & keyof TTarget['dimensions'] & string]:
            TTarget['dimensions'][K] extends { sql: string } ? never
              : K extends TTarget['filters'][K]['field']
                ? MetricFilter<`${R}.${K}`, unknown, FilterOperators<TTarget['filters'][K]>>
                : never;
        }[keyof TTarget['filters'] & keyof TTarget['dimensions'] & string]
        : never
    : never;
}[keyof TRelationships & string];

/** Filter names and operator policies exposed by a dataset and its to-one targets. */
export type DatasetFilterFor<TDataset extends DatasetInstance<any, any, any, any>> =
  | LocalFilterFor<TDataset['filters']>
  | RelationshipFilterFor<TDataset['relationships']>;

/** Names in the normalized filter allowlist, including one-hop relationship filters. */
export type DatasetFilterNames<TDataset extends DatasetInstance<any, any, any, any>> =
  DatasetFilterFor<TDataset>['field'];
