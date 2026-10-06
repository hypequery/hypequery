import { isSemanticFilterOperator } from '../constants.js';
import type { DatasetQuery, MetricQuery } from '../types.js';

/** Reject SQL structure outside the semantic contract before reaching a builder. */
export function semanticQuerySyntaxErrors(query: DatasetQuery | MetricQuery): string[] {
  const errors: string[] = [];
  for (const filter of query.filters ?? []) {
    if (!isSemanticFilterOperator(filter.operator)) {
      errors.push(`Unsupported semantic filter operator "${String(filter.operator)}".`);
    }
  }
  for (const order of query.orderBy ?? []) {
    if (order.direction !== 'asc' && order.direction !== 'desc') {
      errors.push('Invalid order direction: expected "asc" or "desc".');
    }
  }
  return errors;
}

/** Never interpolate a caller-provided direction into raw SQL. */
export function semanticOrderDirection(direction: unknown): 'ASC' | 'DESC' {
  if (direction === 'asc') return 'ASC';
  if (direction === 'desc') return 'DESC';
  throw new Error('Invalid order direction: expected "asc" or "desc".');
}
