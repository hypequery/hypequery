import type { ProtocolExpression } from '../expressions/index.js';

/** A comparison, or `and`/`or`/`not` over predicates: what a filter may be. */
export function isProtocolPredicate(expression: ProtocolExpression): boolean {
  if (expression.kind === 'comparison') return true;
  if (expression.kind !== 'logical') return false;
  return expression.operator === 'not'
    ? isProtocolPredicate(expression.operand)
    : expression.operands.every(isProtocolPredicate);
}
