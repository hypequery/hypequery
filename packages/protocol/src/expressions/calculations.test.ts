import { describe, expect, it } from 'vitest';
import {
  validateProtocolSemanticInvocationResult,
  validateProtocolSemanticInvocationV2,
} from '../invocations/index.js';
import { validateProtocolSemanticQuery } from './validate.js';

const query = (fields: Record<string, unknown>) => ({ kind: 'dataset', dataset: 'orders', measures: ['revenue'], ...fields });
const result = (meta: Record<string, unknown>) => ({
  kind: 'hypequery-semantic-invocation-result', version: 1, activationRevision: 'a'.repeat(64),
  data: [], meta: { rowCount: 0, ...meta },
});

describe('RFC 0026 query envelope', () => {
  it('normalizes calculations, limitBy and other as written', () => {
    const input = query({
      dimensions: ['country'], by: 'month',
      calculations: [
        { name: 'prior', shift: { measure: 'revenue', amount: 1, unit: 'month' } },
        { name: 'growth', formula: { op: 'percentChange', args: ['revenue', 'prior'] } },
      ],
      having: [{ measure: 'growth', operator: 'gt', value: 0 }],
      orderBy: [{ field: 'growth', direction: 'desc' }],
      limitBy: { n: 3, by: ['period'] },
      other: { dimension: 'country', n: 5, measure: 'revenue', label: 'Rest' },
    });
    expect(JSON.parse(JSON.stringify(validateProtocolSemanticQuery(input, { extension: 2 })))).toEqual(input);
  });

  it('is extension 2 only', () => {
    expect(() => validateProtocolSemanticQuery(query({ calculations: [] }), { extension: 1 }))
      .toThrow(expect.objectContaining({ code: 'HQ_EXPRESSION_UNKNOWN_FIELD', path: '$.calculations' }));
  });

  it('counts formula nesting toward the depth limit', () => {
    let node: unknown = 'revenue';
    for (let depth = 0; depth < 20; depth += 1) node = { op: 'nullIfZero', args: [node] };
    expect(() => validateProtocolSemanticQuery(query({ calculations: [{ name: 'deep', formula: node }] }), { extension: 2 }))
      .toThrow(expect.objectContaining({ code: 'HQ_EXPRESSION_TOO_DEEP' }));
  });

  it('makes a calculated query an invocation 2 record', () => {
    const invocation = (operation: Record<string, unknown>) => ({
      kind: 'hypequery-semantic-invocation', version: 2,
      target: { project: 'p', environment: 'e' }, operation,
    });
    expect(validateProtocolSemanticInvocationV2(invocation(query({
      calculations: [{ name: 'r', rank: { measure: 'revenue' } }],
    }))).operation).toMatchObject({ calculations: [{ name: 'r' }] });
    expect(() => validateProtocolSemanticInvocationV2(invocation(query({ calculations: [] }))))
      .toThrow(expect.objectContaining({ code: 'HQ_INVOCATION_INVALID_VERSION' }));
  });
});

describe('RFC 0026 result metadata', () => {
  const column = { name: 'revenue_change_pct', kind: 'formula', calculation: 'mom', type: 'number', format: 'ratio' };

  it('accepts typed calculation columns', () => {
    expect(validateProtocolSemanticInvocationResult(result({ calculations: [column] })).meta.calculations)
      .toEqual([column]);
  });

  it.each([
    ['an unknown member', { ...column, unit: '%' }, 'HQ_INVOCATION_UNKNOWN_FIELD'],
    ['an unknown kind', { ...column, kind: 'compare' }, 'HQ_INVOCATION_INVALID_VALUE'],
    ['an unknown type', { ...column, type: 'string' }, 'HQ_INVOCATION_INVALID_VALUE'],
    ['an unknown format', { ...column, format: 'percent' }, 'HQ_INVOCATION_INVALID_VALUE'],
    ['a missing calculation', { name: 'x', kind: 'rank', type: 'integer' }, 'HQ_INVOCATION_TYPE'],
  ])('rejects %s', (_name, entry, code) => {
    expect(() => validateProtocolSemanticInvocationResult(result({ calculations: [entry] })))
      .toThrow(expect.objectContaining({ code }));
  });

  it('rejects duplicate column names', () => {
    expect(() => validateProtocolSemanticInvocationResult(result({ calculations: [column, column] })))
      .toThrow(expect.objectContaining({ code: 'HQ_INVOCATION_INVALID_VALUE' }));
  });
});
