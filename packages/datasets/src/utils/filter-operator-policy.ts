import { isNullCheckFilterOperator } from '../constants.js';

/**
 * Whether a caller filter may apply `operator` under a filter definition.
 *
 * An explicit `operators` list is the whole policy. Without one, every value
 * operator is allowed but the null checks are not: they are opt-in (RFC 0023),
 * so adding them left every existing published operator list unchanged.
 */
export function filterAllowsOperator(
  definition: { readonly operators?: readonly string[] } | undefined,
  operator: string,
): boolean {
  return definition?.operators
    ? definition.operators.includes(operator)
    : !isNullCheckFilterOperator(operator);
}
