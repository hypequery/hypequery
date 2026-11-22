import type { ProtocolExpression } from '@hypequery/protocol';

/**
 * The field a filter expression addresses, or null when it is not a plain
 * comparison.
 *
 * Both operands are checked. A right-hand side that is anything but a literal —
 * another reference, an aggregate, a nested comparison — addresses something
 * this validator never matched against the contract's allowlist, so accepting
 * it would leave a published-surface check to whichever executor happens to be
 * injected. It is also a caller mistake rather than a deployment capability
 * gap, and only a violation raised here reports it as one.
 */
export function comparisonField(expression: ProtocolExpression): { field: string; operator: string } | null {
  if (expression.kind !== 'comparison' || expression.left.kind !== 'reference') return null;
  // A null check (RFC 0023) has no right operand; any other comparison needs a literal one.
  if ('right' in expression && expression.right.kind !== 'literal') return null;
  return { field: String(expression.left.name), operator: expression.operator };
}

