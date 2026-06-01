import type {
  AggregationType,
  FieldType,
  MetricFilter,
  MetricOrderBy,
  TimeGrain,
} from './types.js';

export type SemanticBinaryOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type SemanticFunctionName = 'nullIfZero' | 'coalesce' | 'round' | 'floor' | 'ceil';

export type SemanticExpression =
  | { kind: 'ref'; name: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  | {
    kind: 'binary';
    operator: SemanticBinaryOperator;
    left: SemanticExpression;
    right: SemanticExpression;
  }
  | {
    kind: 'function';
    name: SemanticFunctionName;
    args: SemanticExpression[];
  };

export interface SemanticDimensionPlan {
  name: string;
  field: string;
  fieldType?: FieldType;
}

export interface SemanticAggregationPlan {
  name: string;
  aggregation: AggregationType;
  field: string;
  filters?: MetricFilter[];
}

export interface SemanticGrainPlan {
  field: string;
  unit: TimeGrain;
  output: 'period';
  timezone?: string;
  weekStart?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export type PlanNode =
  | {
    kind: 'aggregate';
    source: string;
    dimensions: SemanticDimensionPlan[];
    aggregations: SemanticAggregationPlan[];
    filters: MetricFilter[];
    grain?: SemanticGrainPlan;
    orderBy?: MetricOrderBy[];
    limit?: number;
    offset?: number;
    tenant?: { field: string; value: string };
  }
  | {
    kind: 'derive';
    input: PlanNode;
    metrics: Array<{ name: string; expression: SemanticExpression }>;
    orderBy?: MetricOrderBy[];
    limit?: number;
    offset?: number;
  };

export interface SemanticBackendResult<T = Record<string, unknown>> {
  data: T[];
  meta?: {
    timingMs?: number;
    sql?: string;
    tenant?: string;
  };
}

export interface SemanticBackend {
  execute<T = Record<string, unknown>>(plan: PlanNode): Promise<SemanticBackendResult<T>>;
  explain?(plan: PlanNode): Promise<{ sql?: string }>;
}
