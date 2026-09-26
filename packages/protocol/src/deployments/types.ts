import type { ProtocolExpression, ProtocolQueryTimeGrain, ProtocolTimeGrain } from '../expressions/index.js';
import type { ProtocolIdentifier, ProtocolQualifiedIdentifier } from '../identifiers/index.js';
import type { ProtocolSqlExpression } from '../query-implementations/index.js';

export type ProtocolDatasetFieldType = 'string' | 'number' | 'boolean' | 'timestamp';
export type ProtocolSemanticSensitivity = 'public' | 'internal' | 'confidential' | 'restricted';

export interface ProtocolSemanticMetadata {
  readonly examples?: readonly string[];
  readonly synonyms?: readonly string[];
  readonly format?: string;
  readonly unit?: string;
  readonly currency?: string;
  readonly timezone?: string;
  readonly sensitivity?: ProtocolSemanticSensitivity;
}

export interface ProtocolDatasetFreshness {
  readonly maxAgeSeconds: number;
}

export interface ProtocolDatasetDefaults {
  readonly dimensions?: readonly ProtocolIdentifier[];
  readonly timeGrain?: ProtocolTimeGrain;
}

export type ProtocolAccessPolicy =
  | { readonly kind: 'public' }
  | {
      readonly kind: 'authenticated';
      readonly roles: readonly string[];
      readonly scopes: readonly string[];
    };

export type ProtocolEndpointTenantPolicy =
  | { readonly kind: 'not-required' }
  | {
      readonly kind: 'required' | 'optional';
      readonly mode: 'auto-inject' | 'manual';
      readonly column?: string;
    };

export interface ProtocolEndpointPolicy {
  readonly access: ProtocolAccessPolicy;
  readonly tenant: ProtocolEndpointTenantPolicy;
  readonly cacheTtlMs?: number;
  readonly maxLimit?: number;
  readonly path?: string;
}

export type ProtocolDatasetTenantPolicy =
  | { readonly kind: 'required'; readonly field: string }
  | { readonly kind: 'not-required' };

export type ProtocolDatasetFieldSource =
  | { readonly kind: 'column'; readonly column: string }
  | ProtocolSqlExpression;

export interface ProtocolDatasetDimension extends ProtocolSemanticMetadata {
  readonly name: ProtocolIdentifier;
  readonly type: ProtocolDatasetFieldType;
  readonly source: ProtocolDatasetFieldSource;
  readonly filterable: boolean;
  readonly groupable: boolean;
  readonly label?: string;
  readonly description?: string;
}

export interface ProtocolDatasetMeasure extends ProtocolSemanticMetadata {
  readonly name: ProtocolIdentifier;
  readonly aggregation:
    | 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max'
    | 'argMax' | 'argMin' | 'percentile' | 'stddev' | 'variance';
  readonly field: ProtocolQualifiedIdentifier;
  readonly argField?: ProtocolQualifiedIdentifier;
  readonly level?: number;
  readonly sql?: ProtocolSqlExpression;
  readonly filters: readonly ProtocolExpression[];
  readonly label?: string;
  readonly description?: string;
}

export interface ProtocolDatasetFilter extends ProtocolSemanticMetadata {
  readonly name: ProtocolIdentifier;
  readonly field: ProtocolQualifiedIdentifier;
  readonly operators: readonly (
    | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
    | 'in' | 'notIn' | 'between' | 'like'
  )[];
  readonly label?: string;
  readonly description?: string;
}

export interface ProtocolDatasetRelationship {
  readonly name: ProtocolIdentifier;
  readonly kind: 'belongsTo' | 'hasMany' | 'hasOne';
  readonly target: ProtocolIdentifier;
  readonly from: ProtocolQualifiedIdentifier;
  readonly to: ProtocolQualifiedIdentifier;
  readonly queryable: boolean;
}

/** One aggregate a derived metric's formula names, under the alias it named it by. */
export interface ProtocolMetricInput {
  readonly alias: ProtocolIdentifier;
  readonly expression: ProtocolExpression;
}

/**
 * A derived metric's formula in the shape it was authored in.
 *
 * `ProtocolDatasetMetric.expression` inlines each input aggregate where the
 * formula referenced it, which says what the metric means but loses the aliases
 * the author chose. Those aliases are not cosmetic: they are emitted as the
 * column names of the intermediate aggregate and referenced by the outer
 * select, so a catalog rebuilt without them computes the same number through
 * different SQL. `expression` here references the aliases instead, and
 * validation proves that substituting the inputs back into it reproduces the
 * inlined form exactly — the two can describe the same formula or the contract
 * is invalid, never disagree silently.
 */
export interface ProtocolMetricDerivation {
  readonly inputs: readonly ProtocolMetricInput[];
  readonly expression: ProtocolExpression;
}

export interface ProtocolDatasetMetric extends ProtocolSemanticMetadata {
  readonly name: ProtocolIdentifier;
  readonly kind: 'metric' | 'derived-metric' | 'grained-metric';
  readonly expression: ProtocolExpression;
  /**
   * Present only on a derived metric, and optional: a contract written before
   * this field existed stays valid and simply is not portably executable.
   */
  readonly derivation?: ProtocolMetricDerivation;
  readonly dimensions: readonly ProtocolQualifiedIdentifier[];
  readonly filters: readonly ProtocolIdentifier[];
  readonly grains: readonly ProtocolTimeGrain[];
  readonly grain?: ProtocolTimeGrain;
  readonly label?: string;
  readonly description?: string;
  readonly endpoint: ProtocolEndpointPolicy;
}

export interface ProtocolDatasetLimits {
  readonly maxDimensions?: number;
  readonly maxMeasures?: number;
  readonly maxFilters?: number;
  readonly maxResultSize?: number;
}

export interface ProtocolDatasetContract extends ProtocolSemanticMetadata {
  readonly name: ProtocolIdentifier;
  readonly description?: string;
  readonly source: string;
  readonly freshness?: ProtocolDatasetFreshness;
  readonly owner?: string;
  readonly defaults?: ProtocolDatasetDefaults;
  readonly tenant: ProtocolDatasetTenantPolicy;
  readonly timeField?: ProtocolQualifiedIdentifier;
  readonly dimensions: readonly ProtocolDatasetDimension[];
  readonly measures: readonly ProtocolDatasetMeasure[];
  readonly filters: readonly ProtocolDatasetFilter[];
  readonly metrics: readonly ProtocolDatasetMetric[];
  readonly relationships: readonly ProtocolDatasetRelationship[];
  readonly limits?: ProtocolDatasetLimits;
  readonly endpoint?: ProtocolEndpointPolicy;
}

/** A post-aggregation formula over base measures in the same dataset. */
export interface ProtocolDatasetDerivedMeasure extends ProtocolSemanticMetadata {
  readonly kind: 'derived';
  readonly name: ProtocolIdentifier;
  /** Authored alias order is retained for deterministic reconstruction. */
  readonly uses: readonly {
    readonly alias: ProtocolIdentifier;
    readonly measure: ProtocolIdentifier;
  }[];
  readonly expression: ProtocolExpression;
  readonly label?: string;
  readonly description?: string;
}

/** The v2 wire folds authored base and derived measures into one collection. */
export type ProtocolDeploymentMeasure = ProtocolDatasetMeasure | ProtocolDatasetDerivedMeasure;

export interface ProtocolDeploymentDataset extends Omit<ProtocolDatasetContract, 'measures' | 'metrics'> {
  readonly measures: readonly ProtocolDeploymentMeasure[];
  readonly metrics?: never;
}

/** The deployment contract contains executable datasets and derived measures. */
export interface ProtocolDeploymentContract {
  readonly kind: 'hypequery-deployment';
  readonly version: 2;
  readonly datasets: readonly ProtocolDeploymentDataset[];
  readonly queries?: never;
  readonly artifacts?: never;
}

/** A named, author-defined predicate over a dataset's own dimensions (RFC 0015). */
export interface ProtocolDatasetSegment extends ProtocolSemanticMetadata {
  readonly name: ProtocolIdentifier;
  readonly predicate: ProtocolExpression;
  readonly label?: string;
  readonly description?: string;
}

/** A contract 3 base measure: adds `approxCountDistinct` and its `approximate` marker. */
export interface ProtocolDatasetMeasureV3 extends Omit<ProtocolDatasetMeasure, 'aggregation'> {
  readonly aggregation: ProtocolDatasetMeasure['aggregation'] | 'approxCountDistinct';
  /** Present, and `true`, exactly when the aggregation is approximate. */
  readonly approximate?: true;
}

/** A contract 3 derived measure: approximate when any measure it uses is. */
export interface ProtocolDatasetDerivedMeasureV3 extends ProtocolDatasetDerivedMeasure {
  readonly approximate?: true;
}

/** A whole number of time units, such as `{ amount: 7, unit: 'day' }`. */
export interface ProtocolTimeInterval {
  readonly amount: number;
  readonly unit: ProtocolQueryTimeGrain;
}

interface ProtocolTimeMeasureCommon extends ProtocolSemanticMetadata {
  readonly name: ProtocolIdentifier;
  /** The base measure of the same dataset this measure wraps. */
  readonly measure: ProtocolIdentifier;
  /** Present, and `true`, exactly when the wrapped measure is approximate. */
  readonly approximate?: true;
  readonly label?: string;
  readonly description?: string;
}

/**
 * A rolling, to-date, or cumulative window over a base measure (RFC 0015).
 * Exactly one of `trailing`, `toDate`, and `cumulative` is present.
 */
export interface ProtocolDatasetWindowMeasure extends ProtocolTimeMeasureCommon {
  readonly kind: 'window';
  readonly trailing?: ProtocolTimeInterval;
  readonly toDate?: Exclude<ProtocolQueryTimeGrain, 'minute'>;
  readonly cumulative?: true;
}

/** A base measure evaluated over the bucket shifted back by `interval` (RFC 0015). */
export interface ProtocolDatasetShiftMeasure extends ProtocolTimeMeasureCommon {
  readonly kind: 'shift';
  readonly interval: ProtocolTimeInterval;
}

export type ProtocolDeploymentMeasureV3 =
  | ProtocolDatasetMeasureV3
  | ProtocolDatasetDerivedMeasureV3
  | ProtocolDatasetWindowMeasure
  | ProtocolDatasetShiftMeasure;

/**
 * A contract 3 dataset. The filter allow-list is renamed `allowedFilters`, and
 * datasets carry `segments`.
 */
export interface ProtocolDeploymentDatasetV3
  extends Omit<ProtocolDeploymentDataset, 'measures' | 'filters' | 'defaults'> {
  readonly measures: readonly ProtocolDeploymentMeasureV3[];
  readonly allowedFilters: readonly ProtocolDatasetFilter[];
  readonly segments: readonly ProtocolDatasetSegment[];
  readonly defaults?: {
    readonly dimensions?: readonly ProtocolIdentifier[];
    readonly timeGrain?: ProtocolQueryTimeGrain;
  };
  readonly filters?: never;
}

/** Deployment contract 3 (RFC 0015). */
export interface ProtocolDeploymentContractV3 {
  readonly kind: 'hypequery-deployment';
  readonly version: 3;
  readonly datasets: readonly ProtocolDeploymentDatasetV3[];
}

export interface ProtocolDeploymentLimits {
  readonly maxDatasets: number;
  readonly maxDatasetItems: number;
  /**
   * Ceiling on each semantic-metadata collection (`examples`, `synonyms`, and
   * `defaults.dimensions`). Deliberately tighter than `maxDatasetItems`: these
   * are authoring aids, and the definition-time validator in
   * `@hypequery/datasets` applies the same ceiling.
   */
  readonly maxSemanticMetadataItems: number;
  readonly maxTextBytes: number;
  readonly maxSourceBytes: number;
  readonly maxPathBytes: number;
}

/**
 * Validation budgets for a deployment contract.
 *
 * Each configured value must be a positive safe integer no greater than the
 * corresponding value in `DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS`. These options
 * may tighten the deployment contract limits, but cannot raise
 * them; they are not deployment capacity settings.
 */
export interface ProtocolDeploymentOptions {
  readonly limits?: Partial<ProtocolDeploymentLimits>;
}

export type ProtocolDeploymentErrorCode =
  | 'HQ_DEPLOYMENT_TYPE'
  | 'HQ_DEPLOYMENT_UNKNOWN_FIELD'
  | 'HQ_DEPLOYMENT_INVALID_VERSION'
  | 'HQ_DEPLOYMENT_INVALID_IDENTIFIER'
  | 'HQ_DEPLOYMENT_INVALID_VALUE'
  | 'HQ_DEPLOYMENT_INVALID_REFERENCE'
  | 'HQ_DEPLOYMENT_TOO_MANY_ITEMS'
  | 'HQ_DEPLOYMENT_TOO_LARGE'
  | 'HQ_DEPLOYMENT_UNSAFE_OBJECT';
