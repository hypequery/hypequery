import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProtocolClientQuery } from '@hypequery/protocol';
import { clientHttpResult } from './result.js';

const contract = JSON.parse(readFileSync(new URL('../../../../../specs/security-protocol/fixtures/client-contract-v1/success.json', import.meta.url), 'utf8'))[0].value;
const plan = validateProtocolClientQuery(contract, 'orders', { dimensions: ['country', 'amount', 'customer.tier'], measures: ['revenue'], by: 'day', limit: 1, includeMeta: true });
const value = {
  data: [{ country: 'UK', amount: '9007199254740993', 'customer.tier': null, revenue: '12', period: null }],
  meta: { requestId: 'request-one', timingMs: 1, rowCount: 1, pagination: { limit: 1, offset: 0, hasMore: false }, cache: { hit: false } },
};

describe('strict public HTTP result validation', () => {
  it('preserves nullable rows, decimal strings, periods and public metadata', () => {
    expect(clientHttpResult(JSON.stringify(value), plan)).toEqual(value);
  });
  it('preserves negative zero in a finite numeric dimension', () => {
    const text = JSON.stringify(value).replace('"9007199254740993"', '-0');
    expect(Object.is((clientHttpResult(text, plan).data as Record<string, unknown>[])[0].amount, -0)).toBe(true);
  });
  it.each([
    ['unknown row field', (v: any) => { v.data[0].PRIVATE_SQL = 'SECRET'; }],
    ['missing requested field', (v: any) => { delete v.data[0].revenue; }],
    ['wrong aggregate type', (v: any) => { v.data[0].revenue = 12; }],
    ['nonnullable dimension', (v: any) => { v.data[0].country = null; }],
    ['bad dimension type', (v: any) => { v.data[0].amount = {}; }],
    ['malformed period', (v: any) => { v.data[0].period = 'tomorrow'; }],
    ['unpaired surrogate', (v: any) => { v.data[0].country = '\ud800'; }],
    ['extra root', (v: any) => { v.diagnostics = { sql: 'SECRET' }; }],
    ['private metadata', (v: any) => { v.meta.sql = 'SECRET'; }],
    ['bad row count', (v: any) => { v.meta.rowCount = 9; }],
    ['bad offset', (v: any) => { v.meta.pagination.offset = 1; }],
    ['larger effective limit', (v: any) => { v.meta.pagination.limit = 2; }],
    ['bad hasMore', (v: any) => { v.meta.pagination.hasMore = 'true'; }],
    ['private cache data', (v: any) => { v.meta.cache.tenant = 'SECRET'; }],
    ['absent requested metadata', (v: any) => { delete v.meta; }],
    ['null requested metadata', (v: any) => { v.meta = null; }],
    ['too many rows', (v: any) => { v.data.push(v.data[0]); v.meta.rowCount = 2; }],
  ])('refuses %s without exposing the backend value', (_name, mutate) => {
    const changed = structuredClone(value);
    mutate(changed);
    expect(() => clientHttpResult(JSON.stringify(changed), plan)).toThrow('Backend returned an invalid client result.');
  });
  it('rejects duplicate escaped fields and overflowed numeric cells', () => {
    const text = JSON.stringify(value);
    expect(() => clientHttpResult(text.replace('"UK"', '"UK","\\u0063ountry":"SECRET"'), plan)).toThrow('invalid client result');
    expect(() => clientHttpResult(text.replace('"9007199254740993"', '1e999'), plan)).toThrow('invalid client result');
  });
  it('accepts absent metadata only when it was not requested', () => {
    const ordinary = validateProtocolClientQuery(contract, 'orders', { measures: ['revenue'] });
    expect(clientHttpResult('{"data":[{"revenue":null}]}', ordinary)).toEqual({ data: [{ revenue: null }] });
  });
});
