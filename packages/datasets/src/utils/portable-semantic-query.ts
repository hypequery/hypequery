import type { ProtocolExpression, ProtocolSemanticQuery } from '@hypequery/protocol';
import type {
  DatasetFilterNode,
  DatasetHavingCondition,
  MetricOrderBy,
  SemanticTenantRuntime,
  TimeGrain,
} from '../types.js';
import { PortableExecutionUnsupportedError } from '../portable-execution-errors.js';
import { rehydrateMeasureFilter } from './protocol-rehydrate-filters.js';
import { UNSUPPORTED_CONTRACT_REASONS } from './unsupported-contract-reasons.js';
import { portableCalculationFields } from './portable-query-calculations.js';

export function tenantRuntime(tenant: unknown): SemanticTenantRuntime | undefined {
  if (tenant === undefined || tenant === null) return undefined;
  if (typeof tenant === 'string') return tenant;
  if (Array.isArray(tenant)) return { in: tenant.map(String) };
  return tenant as SemanticTenantRuntime;
}

/**
 * A query predicate as a dataset filter node. `logical` nodes become groups
 * (RFC 0029); every leaf must be a field/operator/value comparison or a null
 * check, which is all the data plane validated against the contract.
 */
function operationFilter(expression: ProtocolExpression, index: number): DatasetFilterNode {
  if (expression.kind === 'logical') {
    return expression.operator === 'not'
      ? { not: operationFilter(expression.operand, index) }
      : expression.operator === 'and'
        ? { and: expression.operands.map(operand => operationFilter(operand, index)) }
        : { or: expression.operands.map(operand => operationFilter(operand, index)) };
  }
  return rehydrateMeasureFilter(
    expression,
    () => new PortableExecutionUnsupportedError(
      `Filter ${index} holds a comparison that is not a field/operator/value comparison, so it cannot be planned.`,
      { reason: UNSUPPORTED_CONTRACT_REASONS.queryFilterNotComparison },
    ),
  );
}

function operationFilters(operation: ProtocolSemanticQuery): DatasetFilterNode[] {
  return (operation.filters ?? []).map(operationFilter);
}

export function semanticQuery(operation: ProtocolSemanticQuery, maxRows: number): Record<string, unknown> {
  const filters = operationFilters(operation);
  const orderBy: MetricOrderBy[] = (operation.orderBy ?? []).map(entry => ({
    field: String(entry.field),
    direction: entry.direction,
  }));
  return {
    ...(operation.dimensions === undefined
      ? {}
      : { dimensions: operation.dimensions.map(String) }),
    ...(operation.kind === 'dataset' && operation.measures !== undefined
      ? { measures: operation.measures.map(String) }
      : {}),
    ...(filters.length > 0 ? { filters } : {}),
    // RFC 0015: the rebuilt dataset resolves each name and rejects unknown ones.
    ...(operation.segments === undefined || operation.segments.length === 0
      ? {}
      : { segments: operation.segments.map(String) }),
    ...(orderBy.length > 0 ? { orderBy } : {}),
    // An omitted limit becomes the budget, so a caller cannot ask for an
    // unbounded scan by leaving it out.
    limit: operation.limit ?? maxRows,
    ...(operation.offset === undefined ? {} : { offset: operation.offset }),
    ...(operation.by === undefined ? {} : { by: operation.by as TimeGrain }),
    // RFC 0029: the data plane checked the axis against the contract.
    ...(operation.timeKey === undefined ? {} : { timeKey: String(operation.timeKey) }),
    // RFC 0025: the dataset client applies both on the queryBuilder path,
    // and validates `having` against the selection again.
    ...(operation.kind === 'dataset' && operation.having !== undefined
      ? {
          having: operation.having.map(condition => ({
            ...condition,
            measure: String(condition.measure),
          })) as DatasetHavingCondition[],
        }
      : {}),
    ...(operation.timezone === undefined ? {} : { timezone: operation.timezone }),
    // RFC 0026: calculations reach the dataset client in its own shape.
    ...(operation.kind === 'dataset' ? portableCalculationFields(operation) : {}),
    // RFC 0029: the dataset client plans a filled series on the time axis.
    ...(operation.kind === 'dataset' && operation.fill === true ? { fill: true } : {}),
  };
}

