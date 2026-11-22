import { describe, expect, it } from 'vitest';
import {
  effectiveFilterLeaves,
  filterLeafCount,
  filterLeaves,
  filterTreeErrors,
  hasFilterGroups,
  isFilterGroup,
  MAX_FILTER_GROUP_DEPTH,
  negatedFilterOperators,
  nestedFilterLeaves,
  topLevelFilterNodes,
} from './filter-tree.js';
import { applyFilterTree } from './filter-predicate-tree.js';
import { semanticQuery } from './portable-semantic-query.js';
import { buildDatasetQuerySignature } from '../cache/query-signature.js';
import { datasetCacheKey, resolveProtocolCacheKeySettings } from '../cache/protocol-cache-keys.js';
import { dataset } from '../dataset.js';
import { dimension } from '../field.js';
import { measure } from '../measure.js';
import type { QueryBuilderLike } from '../query-builder-protocol.js';
import type { DatasetFilterNode, MetricFilter, MetricFilterOperator } from '../types.js';

// RFC 0029: the and/or/not tree helpers every filter consumer shares.
const a: MetricFilter = { field: 'a', operator: 'eq', value: 1 };
const b: MetricFilter = { field: 'b', operator: 'gt', value: 2 };
const c: MetricFilter = { field: 'c', operator: 'isNull' };

function nest(depth: number): DatasetFilterNode {
  let node: DatasetFilterNode = a;
  for (let i = 0; i < depth; i++) node = { not: node };
  return node;
}

describe('filter tree helpers', () => {
  it('tells groups from comparisons', () => {
    expect(isFilterGroup({ or: [a] })).toBe(true);
    expect(isFilterGroup(a)).toBe(false);
    expect(isFilterGroup({ field: 'x', and: [] })).toBe(false);
    expect(isFilterGroup(null)).toBe(false);
    expect(isFilterGroup([a])).toBe(false);
    expect(hasFilterGroups([a, { and: [b] }])).toBe(true);
    expect(hasFilterGroups(undefined)).toBe(false);
  });

  it('lists leaves depth first and counts them', () => {
    const tree: DatasetFilterNode[] = [a, { or: [b, { not: c }] }];
    expect(filterLeaves(tree)).toEqual([a, b, c]);
    expect(filterLeafCount(tree)).toBe(3);
    expect(filterLeaves(undefined)).toEqual([]);
    // Malformed members are left for filterTreeErrors.
    expect(filterLeaves([{ or: 'x' } as never, null as never, [] as never])).toEqual([]);
    // A hostile depth stops being walked.
    expect(filterLeaves([nest(MAX_FILTER_GROUP_DEPTH + 5)])).toEqual([]);
    expect(effectiveFilterLeaves([nest(MAX_FILTER_GROUP_DEPTH + 5)])).toEqual([]);
  });

  it.each<[MetricFilterOperator, readonly MetricFilterOperator[]]>([
    ['eq', ['neq']], ['neq', ['eq']], ['gt', ['lte']], ['gte', ['lt']], ['lt', ['gte']], ['lte', ['gt']],
    ['in', ['notIn']], ['notIn', ['in']], ['isNull', ['isNotNull']], ['isNotNull', ['isNull']],
    ['between', ['lt', 'gt']], ['like', ['like']],
  ])('negates %s', (operator, negated) => {
    expect(negatedFilterOperators(operator)).toEqual(negated);
  });

  it('reports each leaf with its effective operators', () => {
    expect(effectiveFilterLeaves([{ not: { or: [a, { not: b }] } }, c])).toEqual([
      { filter: a, negated: true, operators: ['neq'] },
      { filter: b, negated: false, operators: ['gt'] },
      { filter: c, negated: false, operators: ['isNull'] },
    ]);
    expect(effectiveFilterLeaves([null as never, { and: 'x' } as never])).toEqual([]);
  });

  it('reports structural errors', () => {
    expect(filterTreeErrors(undefined)).toEqual([]);
    expect(filterTreeErrors('x')).toEqual(['Filters must be an array.']);
    expect(filterTreeErrors([1])).toEqual(['Each filter must be an object: a comparison, or an and/or/not group.']);
    expect(filterTreeErrors([{ and: [null] }])).toEqual(['Each filter must be an object: a comparison, or an and/or/not group.']);
    expect(filterTreeErrors([{ and: 'x' }])).toEqual(['An "and" group needs a non-empty array of filters.']);
    expect(filterTreeErrors([{ not: { or: [a, b] } }])).toEqual([]);
    expect(filterTreeErrors([nest(MAX_FILTER_GROUP_DEPTH + 1)]))
      .toEqual([`Filter groups may nest at most ${MAX_FILTER_GROUP_DEPTH} deep.`]);
  });

  it('splices top-level and groups and one-item or groups', () => {
    const or = { or: [b, c] };
    expect(topLevelFilterNodes([{ and: [a, { and: [b] }] }, { or: [c] }, or])).toEqual([a, b, c, or]);
    expect(nestedFilterLeaves([a, or, { not: a }])).toEqual([b, c, a]);
    expect(topLevelFilterNodes(undefined)).toEqual([]);
  });
});

describe('filter tree rendering', () => {
  it('applies a flat list with plain where calls, and needs group methods for or', () => {
    const calls: string[] = [];
    const builder: QueryBuilderLike = new Proxy({} as QueryBuilderLike, {
      get: (_target, property: string) => (...args: unknown[]) => {
        calls.push(`${property}(${args.filter(arg => typeof arg !== 'function').join(',')})`);
        return builder;
      },
    });
    applyFilterTree(builder, [a, { and: [b] }], filter => [{ expression: filter.field, operator: filter.operator, value: filter.value }]);
    expect(calls).toEqual(['where(a,eq,1)', 'where(b,gt,2)']);
    const flat = { where: () => flat } as unknown as QueryBuilderLike;
    expect(() => applyFilterTree(flat, [{ or: [a, b] }], filter => [{ expression: filter.field, operator: filter.operator, value: filter.value }]))
      .toThrow(/whereGroup, orWhere and orWhereGroup/);
  });
});

describe('filter trees across the protocol boundary', () => {
  const Orders = dataset('orders', {
    source: 'orders',
    dimensions: { a: dimension.number(), b: dimension.number(), c: dimension.string() },
    measures: { orders: measure.count('a') },
  });

  it('rehydrates logical and/or/not into groups', () => {
    const comparison = (name: string) => ({
      kind: 'comparison', operator: 'eq',
      left: { kind: 'reference', name }, right: { kind: 'literal', value: 'x' },
    });
    const query = semanticQuery({
      kind: 'dataset', dataset: 'orders',
      filters: [
        { kind: 'logical', operator: 'and', operands: [comparison('a'), comparison('b')] },
        { kind: 'logical', operator: 'or', operands: [comparison('a'), { kind: 'logical', operator: 'not', operand: comparison('c') }] },
      ],
    } as never, 10);
    expect(query.filters).toEqual([
      { and: [{ field: 'a', operator: 'eq', value: 'x' }, { field: 'b', operator: 'eq', value: 'x' }] },
      { or: [{ field: 'a', operator: 'eq', value: 'x' }, { not: { field: 'c', operator: 'eq', value: 'x' } }] },
    ]);
  });

  it('keys groups in both cache signatures', () => {
    const settings = resolveProtocolCacheKeySettings({}, false);
    const key = (filters: DatasetFilterNode[]) => datasetCacheKey(settings, Orders, { measures: ['orders'], filters, limit: 5 }, undefined, undefined);
    expect(key([{ and: [a, b] }])).not.toBe(key([{ or: [a, b] }]));
    expect(key([{ or: [a] }])).toBe(key([a]));
    expect(key([{ not: c }])).toEqual(expect.any(String));
    const signature = (filters: DatasetFilterNode[]) => buildDatasetQuerySignature(Orders, { measures: ['orders'], filters });
    expect(new Set([
      signature([a, b]), signature([{ and: [a, b] }]), signature([{ or: [a, b] }]), signature([{ not: a }]),
    ]).size).toBe(4);
  });
});
