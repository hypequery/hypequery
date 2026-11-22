import type { ProtocolExpression } from '@hypequery/protocol';

/** One comparison inside a caller filter, with where it sits (RFC 0029). */
export interface ProtocolFilterLeaf {
  readonly expression: ProtocolExpression;
  readonly path: string;
  /** True under an odd number of `not`s. */
  readonly negated: boolean;
}

/**
 * Every leaf of a predicate tree, depth first. `and`, `or` and `not` are
 * walked; anything else is a leaf the caller must check is a comparison.
 */
export function protocolFilterLeaves(expression: ProtocolExpression, path: string): ProtocolFilterLeaf[] {
  const leaves: ProtocolFilterLeaf[] = [];
  const visit = (node: ProtocolExpression, at: string, negated: boolean): void => {
    if (node.kind !== 'logical') {
      leaves.push({ expression: node, path: at, negated });
      return;
    }
    if (node.operator === 'not') {
      visit(node.operand, `${at}.operand`, !negated);
      return;
    }
    node.operands.forEach((operand, index) => visit(operand, `${at}.operands[${index}]`, negated));
  };
  visit(expression, path, false);
  return leaves;
}

const NEGATED: Readonly<Record<string, readonly string[]>> = {
  eq: ['neq'], neq: ['eq'],
  gt: ['lte'], gte: ['lt'], lt: ['gte'], lte: ['gt'],
  in: ['notIn'], notIn: ['in'],
  isNull: ['isNotNull'], isNotNull: ['isNull'],
  between: ['lt', 'gt'],
  // No portable notLike: a filter that allows pattern matching allows its negation.
  like: ['like'],
};

/**
 * The operators a comparison applies once `not` is pushed down to it. The
 * allowlist is checked against these, so `not` cannot reach an operator a
 * dataset narrowed away.
 */
export function effectiveFilterOperators(operator: string, negated: boolean): readonly string[] {
  return negated ? NEGATED[operator] ?? [operator] : [operator];
}
