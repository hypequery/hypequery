import type {
  DatasetInstance,
  DimensionDefinition,
  MetricFilter,
  MetricFilterOperator,
  MetricValueFilterOperator,
  RelationshipDefinition,
  SemanticFilterDefinition,
  SemanticFiltersDefinition,
} from '../types.js';

type GeneratedFilter<K extends string> = Omit<SemanticFilterDefinition, 'operators'> & {
  field: K;
  /** Generated filters list no operators, so they admit no null checks (RFC 0023). */
  operators?: undefined;
};

/** The generated allowlist mirrors normalizeFilters; explicit maps replace it. */
export type NormalizedDatasetFilters<
  TDimensions extends Record<string, DimensionDefinition>,
  TFilters extends SemanticFiltersDefinition | undefined,
> = TFilters extends SemanticFiltersDefinition ? TFilters : {
  [K in keyof TDimensions as TDimensions[K] extends { filterable: false } ? never : K]:
    GeneratedFilter<K & string>;
};

/** The declared filters whose field is `K`. */
type DeclaredFiltersOn<TFilters extends SemanticFiltersDefinition, K> = {
  [F in keyof TFilters]: TFilters[F] extends { field: K } ? TFilters[F] : never;
}[keyof TFilters];

// Mirrors effectiveFilters: a dimension's own filter takes the operators of the
// declared filters on its field when every one of them lists operators.
type DimensionFilter<K extends string, TDeclared> = [TDeclared] extends [never]
  ? GeneratedFilter<K>
  : [Exclude<TDeclared, { operators: readonly unknown[] }>] extends [never]
    ? Omit<SemanticFilterDefinition, 'field' | 'operators'> & {
      field: K;
      operators: TDeclared extends { operators: infer TOperators } ? TOperators : never;
    }
    : GeneratedFilter<K>;

/**
 * The filters a caller may apply, mirroring effectiveFilters: the declared
 * filters plus one per filterable dimension no declared filter is named after.
 */
export type EffectiveDatasetFilters<
  TDimensions extends Record<string, DimensionDefinition>,
  TFilters extends SemanticFiltersDefinition,
> = TFilters & {
  [K in keyof TDimensions as K extends keyof TFilters ? never
    : TDimensions[K] extends { filterable: false } ? never : K]:
    DimensionFilter<K & string, DeclaredFiltersOn<TFilters, K>>;
};

type FiltersOf<TDataset extends DatasetInstance<any, any, any, any>> =
  EffectiveDatasetFilters<TDataset['dimensions'], TDataset['filters']>;

// Null checks (RFC 0023) are opt-in: a filter known to have no operator list
// admits only the value operators. A widened definition, whose list may or may
// not be present, keeps every operator and leaves the check to runtime.
type FilterOperators<TDefinition> = TDefinition extends {
  operators: readonly (infer TOperator extends MetricFilterOperator)[];
} ? TOperator
  : TDefinition extends { operators?: infer TList }
    ? [NonNullable<TList>] extends [never] ? MetricValueFilterOperator : MetricFilterOperator
    // No `operators` member at all (a weak-type mismatch above).
    : MetricValueFilterOperator;

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
          [K in keyof FiltersOf<TTarget> & keyof TTarget['dimensions'] & string]:
            TTarget['dimensions'][K] extends { sql: string } ? never
              : K extends FiltersOf<TTarget>[K]['field']
                ? MetricFilter<`${R}.${K}`, unknown, FilterOperators<FiltersOf<TTarget>[K]>>
                : never;
        }[keyof FiltersOf<TTarget> & keyof TTarget['dimensions'] & string]
        : never
    : never;
}[keyof TRelationships & string];

/** Filter names and operator policies exposed by a dataset and its to-one targets. */
export type DatasetFilterFor<TDataset extends DatasetInstance<any, any, any, any>> =
  | LocalFilterFor<FiltersOf<TDataset>>
  | RelationshipFilterFor<TDataset['relationships']>;

/** Names a caller may filter on, including one-hop relationship filters. */
export type DatasetFilterNames<TDataset extends DatasetInstance<any, any, any, any>> =
  DatasetFilterFor<TDataset>['field'];
