import type { ProtocolExpression, ProtocolTimeGrain } from '../expressions/index.js';
import type { ProtocolIdentifier, ProtocolQualifiedIdentifier } from '../identifiers/index.js';
import type {
  ProtocolQueryImplementation,
  ProtocolSqlExpression,
} from '../query-implementations/index.js';
import type { ProtocolSchema } from '../schemas/index.js';

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

export interface ProtocolNamedQueryContract {
  readonly name: ProtocolIdentifier;
  readonly input: ProtocolSchema;
  readonly output: ProtocolSchema;
  readonly implementation: ProtocolQueryImplementation;
  readonly endpoint: ProtocolEndpointPolicy & {
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
    readonly path: string;
  };
  readonly summary?: string;
  readonly description?: string;
  readonly tags: readonly string[];
}

export interface ProtocolRuntimeArtifact {
  readonly runtime: 'node' | 'python';
  readonly artifactSha256: string;
}

export interface ProtocolDeploymentContract {
  readonly kind: 'hypequery-deployment';
  readonly version: 1;
  readonly datasets: readonly ProtocolDatasetContract[];
  readonly queries: readonly ProtocolNamedQueryContract[];
  readonly artifacts: readonly ProtocolRuntimeArtifact[];
}

export interface ProtocolDeploymentLimits {
  readonly maxDatasets: number;
  readonly maxQueries: number;
  readonly maxArtifacts: number;
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
 * may tighten the deployment-contract v1 conformance limits, but cannot raise
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
