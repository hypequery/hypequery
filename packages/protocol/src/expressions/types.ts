import type { ProtocolIdentifier, ProtocolQualifiedIdentifier } from '../identifiers/index.js';
import type { CanonicalValue } from '../values/index.js';

export type ProtocolBinaryOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type ProtocolFunctionName = 'nullIfZero' | 'coalesce' | 'round' | 'floor' | 'ceil';
export type ProtocolComparisonOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between' | 'like';
/**
 * Every aggregation any supported expression extension accepts.
 * `approxCountDistinct` is extension 2 (RFC 0015); the validator rejects it
 * under extension 1.
 */
export type ProtocolAggregation =
  | 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max'
  | 'argMax' | 'argMin' | 'percentile' | 'stddev' | 'variance'
  | 'approxCountDistinct';

export type ProtocolExpression =
  | { readonly kind: 'reference'; readonly name: ProtocolQualifiedIdentifier }
  | { readonly kind: 'literal'; readonly value: CanonicalValue }
  | {
      readonly kind: 'binary';
      readonly operator: ProtocolBinaryOperator;
      readonly left: ProtocolExpression;
      readonly right: ProtocolExpression;
    }
  | {
      readonly kind: 'call';
      readonly function: ProtocolFunctionName;
      readonly args: readonly ProtocolExpression[];
    }
  | {
      readonly kind: 'comparison';
      readonly operator: ProtocolComparisonOperator;
      readonly left: ProtocolExpression;
      readonly right: ProtocolExpression;
    }
  | {
      readonly kind: 'logical';
      readonly operator: 'and' | 'or';
      readonly operands: readonly ProtocolExpression[];
    }
  | {
      readonly kind: 'logical';
      readonly operator: 'not';
      readonly operand: ProtocolExpression;
    }
  | {
      readonly kind: 'aggregate';
      readonly aggregation: ProtocolAggregation;
      readonly field: ProtocolQualifiedIdentifier;
      readonly argField?: ProtocolQualifiedIdentifier;
      readonly level?: number;
      readonly filters?: readonly ProtocolExpression[];
    };

/** Expression extension 1 grains, also the deployment contract 2 grain set. */
export type ProtocolTimeGrain = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * Every grain a semantic query may carry under any supported extension.
 * `minute` and `hour` are extension 2 (RFC 0015); the validator rejects them
 * under extension 1.
 */
export type ProtocolQueryTimeGrain = 'minute' | 'hour' | ProtocolTimeGrain;

/** Expression extension versions this implementation validates. */
export type ProtocolExpressionExtension = 1 | 2;

export interface ProtocolOrderBy {
  readonly field: ProtocolQualifiedIdentifier;
  readonly direction: 'asc' | 'desc';
}

interface ProtocolQueryCommon {
  readonly dataset: ProtocolIdentifier;
  readonly dimensions?: readonly ProtocolQualifiedIdentifier[];
  readonly filters?: readonly ProtocolExpression[];
  /** Named segments, AND-combined with `filters`. Extension 2 only. */
  readonly segments?: readonly ProtocolIdentifier[];
  readonly orderBy?: readonly ProtocolOrderBy[];
  readonly limit?: number;
  readonly offset?: number;
  readonly by?: ProtocolQueryTimeGrain;
  readonly includeMeta?: boolean;
}

export interface ProtocolDatasetQuery extends ProtocolQueryCommon {
  readonly kind: 'dataset';
  /**
   * Simple measure names. Extension 2 also accepts one-hop relationship
   * measures such as `customer.customerCount`.
   */
  readonly measures?: readonly ProtocolQualifiedIdentifier[];
}

export interface ProtocolMetricQuery extends ProtocolQueryCommon {
  readonly kind: 'metric';
  readonly metric: ProtocolIdentifier;
}

export type ProtocolSemanticQuery = ProtocolDatasetQuery | ProtocolMetricQuery;

export interface ProtocolExpressionLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxCollectionItems: number;
}

export interface ProtocolExpressionOptions {
  readonly limits?: Partial<ProtocolExpressionLimits>;
  /**
   * Expression extension to validate against. Defaults to 1. The containing
   * artifact selects it (RFC 0015): deployment contract 3 and semantic
   * invocation 2 use extension 2.
   */
  readonly extension?: ProtocolExpressionExtension;
}

export type ProtocolExpressionErrorCode =
  | 'HQ_EXPRESSION_TYPE'
  | 'HQ_EXPRESSION_UNKNOWN_FIELD'
  | 'HQ_EXPRESSION_UNKNOWN_KIND'
  | 'HQ_EXPRESSION_INVALID_IDENTIFIER'
  | 'HQ_EXPRESSION_INVALID_VALUE'
  | 'HQ_EXPRESSION_INVALID_OPERATOR'
  | 'HQ_EXPRESSION_INVALID_ARITY'
  | 'HQ_EXPRESSION_INVALID_AGGREGATION'
  | 'HQ_EXPRESSION_INVALID_QUERY'
  | 'HQ_EXPRESSION_TOO_DEEP'
  | 'HQ_EXPRESSION_TOO_MANY_NODES'
  | 'HQ_EXPRESSION_TOO_MANY_ITEMS'
  | 'HQ_EXPRESSION_UNSAFE_OBJECT';
