import { validateCanonicalValue, type CanonicalValue } from '@hypequery/protocol';
import type { DatasetFilterNode, MetricFilter } from '../types.js';
import { isFilterGroup } from './filter-tree.js';

/**
 * Dataset client filters as RFC 0003 predicates: the inverse of
 * `operationFilter` in `portable-semantic-query.ts`.
 */

function datetimeValue(value: Date): CanonicalValue {
  return validateCanonicalValue({
    $hypequery: {
      type: 'datetime',
      version: 1,
      clickhouseType: 'DateTime64',
      precision: 3,
      timezone: 'UTC',
      value: value.toISOString(),
    },
  });
}

/** A filter value as an RFC 0001 canonical value. Throws when it has none. */
function canonicalLiteral(value: unknown): CanonicalValue {
  if (value instanceof Date) return datetimeValue(value);
  if (Array.isArray(value)) {
    return validateCanonicalValue({
      $hypequery: { type: 'array', version: 1, values: value.map(canonicalLiteral) },
    });
  }
  return validateCanonicalValue(value);
}

/** One comparison as a `comparison` node; a null check has no right operand (RFC 0023). */
export function protocolComparisonNode(filter: MetricFilter): Record<string, unknown> {
  const left = { kind: 'reference', name: filter.field };
  if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
    return { kind: 'comparison', operator: filter.operator, left };
  }
  let literal: CanonicalValue;
  if (filter.operator === 'between' && Array.isArray(filter.value)) {
    // RFC 0003 bounds are a two-item tuple; in/notIn take an array.
    literal = validateCanonicalValue({
      $hypequery: { type: 'tuple', version: 1, values: filter.value.map(canonicalLiteral) },
    });
  } else {
    literal = canonicalLiteral(filter.value);
  }
  return {
    kind: 'comparison',
    operator: filter.operator,
    left,
    right: { kind: 'literal', value: literal },
  };
}

/**
 * A caller filter as an RFC 0003 predicate: a group becomes a `logical` node
 * (RFC 0029), a one-item group its item, since `and`/`or` take two or more.
 */
export function protocolFilterNode(node: DatasetFilterNode): Record<string, unknown> {
  if (!isFilterGroup(node)) return protocolComparisonNode(node);
  if ('not' in node && node.not !== undefined) {
    return { kind: 'logical', operator: 'not', operand: protocolFilterNode(node.not) };
  }
  const operator = 'and' in node && node.and !== undefined ? 'and' : 'or';
  const items = (operator === 'and' ? node.and : node.or)!;
  if (items.length === 1) return protocolFilterNode(items[0]!);
  return { kind: 'logical', operator, operands: items.map(protocolFilterNode) };
}
