import type { ProtocolFilterLeaf } from './filter-leaves.js';

/**
 * The time-range rule of a time-series query (RFC 0015 window and shift
 * measures, RFC 0029 `fill`), checked against the contract so a caller hears
 * `input-invalid` before anything executes. It mirrors the dataset client:
 * exactly one bounded range on the time axis, made of top-level comparisons.
 *
 * Returns the violation message and path, or `undefined` when the filters
 * bound the axis.
 */
export function timeSeriesRangeViolation(
  leaves: readonly ProtocolFilterLeaf[],
  /** The field a leaf's filter name reads, or undefined for a non-comparison. */
  fieldOf: (leaf: ProtocolFilterLeaf) => string | undefined,
  timeAxis: string,
  subject: string,
): { message: string; path: string } | undefined {
  const onAxis = leaves.filter(leaf => fieldOf(leaf) === timeAxis);
  const nested = onAxis.find(leaf => leaf.nested);
  if (nested) {
    return {
      message: `${subject} need their time range as top-level filters: a time-axis comparison inside "or" or "not" cannot bound the series.`,
      path: nested.path,
    };
  }
  const operators = onAxis.map(leaf => (leaf.expression as { operator?: string }).operator);
  const single = operators.length === 1 && (operators[0] === 'between' || operators[0] === 'inDateRange');
  const pair = operators.length === 2
    && operators.some(operator => operator === 'gt' || operator === 'gte')
    && operators.some(operator => operator === 'lt' || operator === 'lte');
  if (single || pair) return undefined;
  return {
    message: `${subject} require exactly one bounded range on "${timeAxis}": between, inDateRange, or gt/gte with lt/lte.`,
    path: '$.operation.filters',
  };
}
