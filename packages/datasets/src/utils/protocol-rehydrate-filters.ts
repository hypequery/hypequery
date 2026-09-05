import type { ProtocolExpression } from '@hypequery/protocol';
import type { MetricFilter } from '../types.js';

/**
 * A measure's fixed filters cross the contract boundary as RFC 0003
 * expressions. `protocol-adapter.ts` only ever emits `reference <op> literal`
 * for them, so this inverts exactly that shape and refuses anything else rather
 * than partially interpreting an expression it cannot faithfully rebuild.
 */
export function rehydrateMeasureFilter(
  expression: ProtocolExpression,
  unsupported: () => Error,
): MetricFilter {
  if (expression.kind !== 'comparison') throw unsupported();
  const { left, right, operator } = expression;
  if (left.kind !== 'reference' || right.kind !== 'literal') throw unsupported();
  return {
    field: String(left.name),
    operator,
    value: fromCanonicalValue(right.value, unsupported),
  } as MetricFilter;
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
  if (tagged.type === 'array') {
    return (tagged.values ?? []).map(item => fromCanonicalValue(item, unsupported));
  }
  if (tagged.value === undefined) throw unsupported();
  return tagged.value;
}
