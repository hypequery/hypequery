import type { ProtocolNullCheckOperator } from './types.js';

/**
 * Comparison operators that test a field for NULL (RFC 0023). They take no
 * right-hand value: a comparison, filter, or client predicate using one must
 * omit it, and validators reject one that carries a value.
 */
export const PROTOCOL_NULL_CHECK_OPERATORS: readonly ProtocolNullCheckOperator[] = Object.freeze([
  'isNull',
  'isNotNull',
]);

/** True for `isNull` and `isNotNull`, the comparison operators without a value. */
export function isProtocolNullCheckOperator(operator: unknown): operator is ProtocolNullCheckOperator {
  return operator === 'isNull' || operator === 'isNotNull';
}
