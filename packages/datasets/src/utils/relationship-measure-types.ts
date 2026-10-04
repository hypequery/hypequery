import type { DatasetInstance, MeasureDefinition, RelationshipDefinition } from '../types.js';

type SafeAggregation = 'countDistinct' | 'approxCountDistinct' | 'min' | 'max' | 'argMax' | 'argMin';
type SqlDimensions<TDimensions> = {
  [K in keyof TDimensions & string]: TDimensions[K] extends { sql: string } ? K : never;
}[keyof TDimensions & string];

type SafeMeasureNames<TMeasures, TKind, TDimensions> = {
  [K in keyof TMeasures & string]: TMeasures[K] extends MeasureDefinition
    ? TMeasures[K] extends { sql: string } ? never
      : TMeasures[K] extends { field: infer F; argField?: infer A }
        ? (Extract<F, SqlDimensions<TDimensions>> | Extract<A, SqlDimensions<TDimensions>>) extends never
          ? TKind extends 'hasOne' ? K
            : TMeasures[K] extends { aggregation: SafeAggregation } ? K : never
          : never
        : never
    : never;
}[keyof TMeasures & string];

/** One-hop base aggregates whose cardinality is safe for the declared relationship. */
export type QueryableRelationshipMeasureNames<TRelationships> = {
  [K in keyof TRelationships & string]: TRelationships[K] extends RelationshipDefinition<infer TTarget, infer TKind>
    ? TKind extends 'hasMany' ? never
      : TTarget extends DatasetInstance<infer TDimensions, infer TMeasures, any, any>
        ? `${K}.${SafeMeasureNames<TMeasures, TKind, TDimensions>}` : never
    : never;
}[keyof TRelationships & string];

export type RelationshipMeasureDefinition<TDataset, TName extends string> =
  TDataset extends { relationships: infer TRelationships }
    ? TName extends `${infer R}.${infer M}`
      ? R extends keyof TRelationships
        ? TRelationships[R] extends RelationshipDefinition<infer TTarget>
          ? TTarget extends { measures: infer TMeasures }
            ? M extends keyof TMeasures ? TMeasures[M] : never : never
          : never : never
      : never : never;
