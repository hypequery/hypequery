import { ProtocolExpressionError, validateProtocolSemanticQuery } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { toProtocolDatasetQuery } from './protocol-dataset-query.js';
import { semanticQuery } from './portable-semantic-query.js';

describe('toProtocolDatasetQuery', () => {
  it('writes a dataset client query as the envelope a data plane validates', () => {
    const operation = toProtocolDatasetQuery('orders', {
      dimensions: ['country'],
      measures: ['revenue', 'orders'],
      filters: [
        { or: [{ field: 'country', operator: 'eq', value: 'US' }, { field: 'country', operator: 'eq', value: 'CA' }] },
        { not: { and: [{ field: 'status', operator: 'isNull' }] } },
        { field: 'createdAt', operator: 'inDateRange', value: 'last 30 days' },
        { field: 'amount', operator: 'between', value: [1, 10] },
      ],
      calculations: [
        { name: 'web', filter: { measure: 'revenue', where: [{ field: 'channel', operator: 'in', value: ['web', 'app'] }] } },
        { name: 'vs', compare: { to: 'previousPeriod', measures: ['revenue'] } },
      ],
      having: [{ measure: 'revenue', operator: 'gt', value: 0 }],
      limitBy: { n: 3, by: ['period'] },
      other: { dimension: 'country', n: 5, measure: 'revenue' },
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      limit: 50,
      offset: 10,
      by: 'month',
      timeKey: 'shippedAt',
      timezone: 'Europe/London',
      fill: true,
      includeMeta: true,
    });

    // Document order, as RFC 0003, 0026 and 0029 place each member.
    expect(Object.keys(operation)).toEqual([
      'kind', 'dataset', 'dimensions', 'measures', 'filters', 'calculations', 'having', 'limitBy', 'other',
      'orderBy', 'limit', 'offset', 'by', 'timeKey', 'timezone', 'fill', 'includeMeta',
    ]);
    expect(operation.filters).toEqual([
      { kind: 'logical', operator: 'or', operands: [
        { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'country' }, right: { kind: 'literal', value: 'US' } },
        { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'country' }, right: { kind: 'literal', value: 'CA' } },
      ] },
      // A one-item group is its item; `and` takes two or more operands.
      { kind: 'logical', operator: 'not', operand: { kind: 'comparison', operator: 'isNull', left: { kind: 'reference', name: 'status' } } },
      { kind: 'comparison', operator: 'inDateRange', left: { kind: 'reference', name: 'createdAt' }, right: { kind: 'literal', value: 'last 30 days' } },
      { kind: 'comparison', operator: 'between', left: { kind: 'reference', name: 'amount' },
        right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: [1, 10] } } } },
    ]);
    expect((operation.calculations as unknown[])[0]).toEqual({
      name: 'web',
      filter: { measure: 'revenue', where: [{
        kind: 'comparison', operator: 'in', left: { kind: 'reference', name: 'channel' },
        right: { kind: 'literal', value: { $hypequery: { type: 'array', version: 1, values: ['web', 'app'] } } },
      }] },
    });
    expect(() => validateProtocolSemanticQuery(operation, { extension: 2 })).not.toThrow();
  });

  it('round-trips through the portable runtime\'s reading of an operation', () => {
    const query = {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [{ or: [{ field: 'country', operator: 'eq' as const, value: 'US' }, { not: { field: 'status', operator: 'eq' as const, value: 'refunded' } }] }],
      by: 'day' as const,
      fill: true,
    };
    const operation = validateProtocolSemanticQuery(toProtocolDatasetQuery('orders', query), { extension: 2 });
    expect(semanticQuery(operation, 100)).toMatchObject({ filters: query.filters, by: 'day', fill: true });
  });

  it('copies rather than shares the caller\'s values, and omits what the query leaves out', () => {
    const calculations = [{ name: 'r', rank: { measure: 'revenue', within: ['country'] } }];
    const operation = toProtocolDatasetQuery('orders', { measures: ['revenue'], calculations });
    expect(operation).toEqual({ kind: 'dataset', dataset: 'orders', measures: ['revenue'], calculations });
    expect(operation.calculations).not.toBe(calculations);
  });

  it('drops nothing, so an extension 1 validator refuses what it cannot run', () => {
    const operation = toProtocolDatasetQuery('orders', {
      measures: ['revenue'], calculations: [{ name: 'r', rank: { measure: 'revenue' } }],
    });
    expect(() => validateProtocolSemanticQuery(operation, { extension: 1 })).toThrow(ProtocolExpressionError);
  });
});
