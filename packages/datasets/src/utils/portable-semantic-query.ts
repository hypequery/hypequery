import type { ProtocolSemanticQuery } from '@hypequery/protocol';
import type { MetricFilter, MetricOrderBy, SemanticTenantRuntime, TimeGrain } from '../types.js';
import { PortableExecutionUnsupportedError } from '../portable-execution-errors.js';
import { rehydrateMeasureFilter } from './protocol-rehydrate-filters.js';

export function tenantRuntime(tenant: unknown): SemanticTenantRuntime | undefined {
  if (tenant === undefined || tenant === null) return undefined;
  if (typeof tenant === 'string') return tenant;
  if (Array.isArray(tenant)) return { in: tenant.map(String) };
  return tenant as SemanticTenantRuntime;
}

function operationFilters(operation: ProtocolSemanticQuery): MetricFilter[] {
  return (operation.filters ?? []).map((expression, index) => rehydrateMeasureFilter(
    expression,
    () => new PortableExecutionUnsupportedError(
      `Filter ${index} is not a field/operator/value comparison, so it cannot be planned.`,
    ),
  ));
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
    ...(orderBy.length > 0 ? { orderBy } : {}),
    // An omitted limit becomes the budget, so a caller cannot ask for an
    // unbounded scan by leaving it out.
    limit: operation.limit ?? maxRows,
    ...(operation.offset === undefined ? {} : { offset: operation.offset }),
    ...(operation.by === undefined ? {} : { by: operation.by as TimeGrain }),
  };
}

