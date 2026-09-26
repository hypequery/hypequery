/**
 * Contract 3 segment rules (RFC 0015) that depend on the owning dataset:
 * predicate shape, and which references a predicate may make.
 */

import type { ProtocolExpression } from '../expressions/index.js';
import type { ProtocolDatasetDimension, ProtocolDatasetTenantPolicy } from './types.js';

/**
 * True for a comparison between references and literals, or a logical tree
 * whose leaves are all such comparisons. Aggregates, arithmetic, and calls are
 * excluded: a segment selects rows by their own dimension values.
 */
export function isSegmentPredicate(expression: ProtocolExpression): boolean {
  if (expression.kind === 'comparison') {
    return isSegmentOperand(expression.left) && isSegmentOperand(expression.right);
  }
  if (expression.kind !== 'logical') return false;
  return expression.operator === 'not'
    ? isSegmentPredicate(expression.operand)
    : expression.operands.every(isSegmentPredicate);
}

function isSegmentOperand(expression: ProtocolExpression): boolean {
  return expression.kind === 'reference' || expression.kind === 'literal';
}

/** Every reference name in an expression, in document order. */
export function expressionReferences(expression: ProtocolExpression): string[] {
  switch (expression.kind) {
    case 'reference':
      return [expression.name];
    case 'literal':
      return [];
    case 'binary':
    case 'comparison':
      return [...expressionReferences(expression.left), ...expressionReferences(expression.right)];
    case 'call':
      return expression.args.flatMap(expressionReferences);
    case 'logical':
      return expression.operator === 'not'
        ? expressionReferences(expression.operand)
        : expression.operands.flatMap(expressionReferences);
    case 'aggregate':
      // Not reachable for a predicate; listed so a caller cannot miss one.
      return [expression.field];
  }
}

/**
 * True when a segment predicate may reference `name`. It must be one of the
 * dataset's own dimensions: never relationship-qualified, and never the tenant
 * field, which only trusted runtime context may constrain.
 */
export function isSegmentReference(
  name: string,
  dimensions: readonly ProtocolDatasetDimension[],
  tenant: ProtocolDatasetTenantPolicy,
): boolean {
  const dimension = dimensions.find(item => item.name === name);
  if (!dimension) return false;
  if (tenant.kind !== 'required') return true;
  const column = dimension.source.kind === 'column' ? dimension.source.column : undefined;
  return dimension.name !== tenant.field && column !== tenant.field;
}
