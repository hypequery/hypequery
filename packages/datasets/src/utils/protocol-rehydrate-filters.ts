import type { ProtocolExpression } from '@hypequery/protocol';
import type { MeasureFilterNode, MetricFilter } from '../types.js';
import { MAX_FILTER_GROUP_DEPTH } from './filter-tree.js';

/**
 * A measure's fixed filters cross the contract boundary as RFC 0003
 * expressions. `protocol-adapter.ts` only ever emits `reference <op> literal`
 * (or `reference isNull` / `isNotNull`) for them, so this inverts exactly that shape and refuses anything else rather
 * than partially interpreting an expression it cannot faithfully rebuild.
 */
export function rehydrateMeasureFilter(
  expression: ProtocolExpression,
  unsupported: () => Error,
): MetricFilter {
  if (expression.kind !== 'comparison') throw unsupported();
  if (!('right' in expression)) {
    // A null check (RFC 0023): `reference isNull`, with no value to unwrap.
    if (expression.left.kind !== 'reference') throw unsupported();
    return { field: String(expression.left.name), operator: expression.operator };
  }
  const { left, right, operator } = expression;
  if (left.kind !== 'reference' || right.kind !== 'literal') throw unsupported();
  return {
    field: String(left.name),
    operator,
    value: fromCanonicalValue(right.value, unsupported),
  } as MetricFilter;
}

/**
 * A measure's fixed filter as the node it was authored as: a comparison, or a
 * `logical` `and` / `or` / `not` of them as the matching group, in authored
 * order, so the rebuilt measure renders the same SQL as the authored one.
 * Anything else is refused, as `rehydrateMeasureFilter` refuses it.
 */
export function rehydrateMeasureFilterNode(
  expression: ProtocolExpression,
  unsupported: () => Error,
  depth = 1,
): MeasureFilterNode {
  if (expression.kind !== 'logical') return rehydrateMeasureFilter(expression, unsupported);
  if (depth > MAX_FILTER_GROUP_DEPTH) throw unsupported();
  if (expression.operator === 'not') {
    return { not: rehydrateMeasureFilterNode(expression.operand, unsupported, depth + 1) };
  }
  const items = expression.operands.map(operand => rehydrateMeasureFilterNode(operand, unsupported, depth + 1));
  return expression.operator === 'and' ? { and: items } : { or: items };
}

/**
 * Unwraps the RFC 0001 tagged value model back to the plain JavaScript value a
 * measure filter was authored with.
 */
function fromCanonicalValue(value: unknown, unsupported: () => Error): unknown {
  if (value === null || typeof value !== 'object') return value;
  const tagged = (value as { $hypequery?: { type?: string; values?: unknown[]; value?: unknown } })
    .$hypequery;
  if (tagged === undefined) throw unsupported();
  // `in`/`notIn` carry an array; `between` carries a two-item tuple.
  if (tagged.type === 'array' || tagged.type === 'tuple') {
    return (tagged.values ?? []).map(item => fromCanonicalValue(item, unsupported));
  }
  if (tagged.value === undefined) throw unsupported();
  return tagged.value;
}
