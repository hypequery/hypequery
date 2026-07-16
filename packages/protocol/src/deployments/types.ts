import type { ProtocolExpression, ProtocolTimeGrain } from '../expressions/index.js';
import type { ProtocolIdentifier, ProtocolQualifiedIdentifier } from '../identifiers/index.js';
import type {
  ProtocolQueryImplementation,
  ProtocolSqlExpression,
} from '../query-implementations/index.js';
import type { ProtocolSchema } from '../schemas/index.js';

export type ProtocolDatasetFieldType = 'string' | 'number' | 'boolean' | 'timestamp';

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

export interface ProtocolDatasetDimension {
  readonly name: ProtocolIdentifier;
  readonly type: ProtocolDatasetFieldType;
  readonly source: ProtocolDatasetFieldSource;
  readonly filterable: boolean;
  readonly groupable: boolean;
  readonly label?: string;
  readonly description?: string;
}

export interface ProtocolDatasetMeasure {
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

export interface ProtocolDatasetFilter {
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

export interface ProtocolDatasetMetric {
  readonly name: ProtocolIdentifier;
  readonly kind: 'metric' | 'derived-metric' | 'grained-metric';
  readonly expression: ProtocolExpression;
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

export interface ProtocolDatasetContract {
  readonly name: ProtocolIdentifier;
  readonly source: string;
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
  readonly maxTextBytes: number;
  readonly maxSourceBytes: number;
  readonly maxPathBytes: number;
}

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
