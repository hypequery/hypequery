import type { ProtocolIdentifier, ProtocolQualifiedIdentifier } from '../identifiers/index.js';
import type { CanonicalValue } from '../values/index.js';

export type ProtocolBinaryOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type ProtocolFunctionName = 'nullIfZero' | 'coalesce' | 'round' | 'floor' | 'ceil';
export type ProtocolComparisonOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between' | 'like';
export type ProtocolAggregation =
  | 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max'
  | 'argMax' | 'argMin' | 'percentile' | 'stddev' | 'variance';

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

export type ProtocolTimeGrain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface ProtocolOrderBy {
  readonly field: ProtocolQualifiedIdentifier;
  readonly direction: 'asc' | 'desc';
}

interface ProtocolQueryCommon {
  readonly dataset: ProtocolIdentifier;
  readonly dimensions?: readonly ProtocolQualifiedIdentifier[];
  readonly filters?: readonly ProtocolExpression[];
  readonly orderBy?: readonly ProtocolOrderBy[];
  readonly limit?: number;
  readonly offset?: number;
  readonly by?: ProtocolTimeGrain;
  readonly includeMeta?: boolean;
}

export interface ProtocolDatasetQuery extends ProtocolQueryCommon {
  readonly kind: 'dataset';
  readonly measures?: readonly ProtocolIdentifier[];
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
