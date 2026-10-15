import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { serializeJcs } from '../values/jcs.js';
import { prepareProtocolClientContract, validateProtocolClientContract } from './validate.js';
import { validateProtocolClientQuery } from './query.js';
import { decodeProtocolClientContract } from './decode.js';
import { ProtocolClientContractError, CLIENT_ERROR_MESSAGES } from './errors.js';

type Data = Record<string, unknown>;
const directory = new URL('../../../../specs/security-protocol/fixtures/client-contract-v1/', import.meta.url);
function fixtures<T>(file: string): T { return JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as T; }
const success = fixtures<{ id: string; value: Data }[]>('success.json');
const contracts = Object.fromEntries(success.map(item => [item.id, item.value]));
const identities = fixtures<{ id: string; canonical: string; sha256: string }[]>('identities.json');
const negative = fixtures<{ id: string; base: string; set: { path: string; value: unknown }[]; error: string }[]>('rejections.json').filter(item => item.base !== undefined);
type QueryCase = { id: string; contract: string; endpoint: string; input: Data; error?: string; transport?: 'http' | 'mcp'; http?: Data };
const queries = [...fixtures<QueryCase[]>('queries.json'), ...fixtures<QueryCase[]>('query-rejections.json')];
function unsigned(input: Data): Data {
  const result = structuredClone(input);
  delete result.contentHash;
  for (const endpoint of result.endpoints as Data[]) delete endpoint.schemaHash;
  return result;
}
function malformed(test: typeof negative[number]): Data {
  const result = structuredClone(contracts[test.base]);
  for (const patch of test.set) {
    const parts = patch.path.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
    let target = result;
    for (const part of parts.slice(0, -1)) target = target[part] as Data;
    const key = parts.at(-1)!;
    if (key === '-') (target as unknown as unknown[]).push(structuredClone(patch.value));
    else target[key] = structuredClone(patch.value);
  }
  // Shape validation precedes identity validation; malformed descriptors need no signing oracle.
  return result;
}
describe('client contract vectors', () => {
  it.each(success)('validates and independently hashes $id', ({ id, value }) => {
    expect(validateProtocolClientContract(value)).toEqual(value);
    const prepared = prepareProtocolClientContract(unsigned(value));
    const identity = identities.find(item => item.id === id)!;
    expect(prepared.canonical).toBe(identity.canonical);
    expect(prepared.contentHash).toBe(identity.sha256);
    const { contentHash, ...body } = prepared.contract;
    expect(createHash('sha256').update('hypequery:client-contract:v1\0' + serializeJcs(body)).digest('hex')).toBe(contentHash);
  });
  it.each(negative)('rejects $id before trusting hashes', test => {
    expect(() => validateProtocolClientContract(malformed(test))).toThrowError(
      expect.objectContaining({ code: test.error, message: CLIENT_ERROR_MESSAGES[test.error as keyof typeof CLIENT_ERROR_MESSAGES] }));
  });
  it.each(queries)('queries: $id', test => {
    const execute = () => validateProtocolClientQuery(contracts[test.contract], test.endpoint, test.input, test.transport);
    if (test.error) expect(execute).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_QUERY' }));
    else {
      const result = execute();
      if (test.http) expect(result.body).toMatchObject(test.http);
      if (test.id === 'clamped-limit') expect(result.effectiveLimit).toBe(1000);
    }
  });
  it.each(['dimensions', 'measures', 'filters', 'having', 'orderBy', 'limit', 'offset', 'by', 'timezone', 'includeMeta'])('refuses null %s', key => {
    expect(() => validateProtocolClientQuery(contracts.build, 'orders', { [key]: null })).toThrowError(ProtocolClientContractError);
  });
  it('snapshots and freezes results without retaining caller state', () => {
    const input = structuredClone(contracts.build);
    const result = validateProtocolClientContract(input);
    (input.endpoints as Data[])[0].path = '/changed';
    expect(result.endpoints[0].path).not.toBe('/changed');
    expect(Object.isFrozen(result.endpoints[0].dimensions.country)).toBe(true);
  });
  it('refuses supplied unsigned identities', () => {
    expect(() => prepareProtocolClientContract(contracts.build)).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_UNKNOWN_FIELD' }));
  });
  it('decodes text and rejects duplicate keys including escaped aliases', () => {
    expect(decodeProtocolClientContract(JSON.stringify(contracts.build))).toEqual(contracts.build);
    expect(() => decodeProtocolClientContract('{"version":1,"\\u0076ersion":1}')).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_DUPLICATE', path: '' }));
  });
  it.each(['{"x":1,}', '[1,]', '{"x":01}', 'null trailing', '"\u0001"'])('refuses malformed JSON %s', value => {
    expect(() => decodeProtocolClientContract(value)).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_TYPE' }));
  });
  it('bounds raw whitespace, nesting, and invalid Unicode', () => {
    expect(() => decodeProtocolClientContract(' '.repeat(1_048_577))).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_LIMIT' }));
    expect(() => decodeProtocolClientContract('['.repeat(17) + '0' + ']'.repeat(17))).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_LIMIT' }));
    expect(() => validateProtocolClientContract({ value: '\uD800' })).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_TYPE' }));
  });
  it('never invokes getters or toJSON and sanitizes host exceptions', () => {
    let calls = 0;
    for (const value of [Object.defineProperty({}, 'secret', { enumerable: true, get() { calls++; throw Error('secret'); } }),
      { toJSON() { calls++; return {}; } }, new Proxy({}, { ownKeys() { throw Error('secret'); } }),
      new Proxy({}, { getPrototypeOf() { throw new ProtocolClientContractError('HQ_CLIENT_LIMIT', 'secret'); } }),
      new Proxy({}, { ownKeys() { throw new Proxy({}, { getPrototypeOf() { throw Error('secret'); } }); } })]) {
      expect(() => validateProtocolClientContract(value)).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_TYPE', message: CLIENT_ERROR_MESSAGES.HQ_CLIENT_TYPE }));
    }
    expect(calls).toBe(0);
  });
  it('refuses cycles, custom prototypes, symbols, sparse arrays, and nonenumerable properties', () => {
    const cycle: Data = {}; cycle.self = cycle;
    for (const value of [cycle, new Date(), { [Symbol('secret')]: 1 }, Array(2), Object.defineProperty({}, 'secret', { value: 1 })]) {
      expect(() => validateProtocolClientContract(value)).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_TYPE' }));
    }
  });
});

it('pins timezone spellings independently of host ICU aliases and casing', () => {
  for (const zone of ['UTC', 'America/New_York', 'Etc/GMT+5', 'US/Eastern']) {
    expect(() => validateProtocolClientQuery(contracts.build, 'orders', { timezone: zone })).not.toThrow();
  }
  for (const zone of ['utc', 'america/new_york', 'Factory', 'localtime', '+01:00']) {
    expect(() => validateProtocolClientQuery(contracts.build, 'orders', { timezone: zone })).toThrowError(ProtocolClientContractError);
  }
});

it('enforces preflight count budgets before malformed node shapes', () => {
  const expectCode = (endpoints: unknown[], code: string) => expect(() => validateProtocolClientContract({ ...contracts.build, endpoints })).toThrowError(expect.objectContaining({ code }));
  expectCode(Array.from({ length: 256 }, () => ({})), 'HQ_CLIENT_SHAPE');
  expectCode(Array.from({ length: 257 }, () => ({})), 'HQ_CLIENT_LIMIT');
  const fields = Object.fromEntries(Array.from({ length: 256 }, (_, i) => ['field' + i, null]));
  expectCode([{ dimensions: fields }], 'HQ_CLIENT_SHAPE');
  expectCode([{ dimensions: { ...fields, extra: null } }], 'HQ_CLIENT_LIMIT');
  expectCode(Array.from({ length: 64 }, () => ({ dimensions: fields })), 'HQ_CLIENT_SHAPE');
  expectCode(Array.from({ length: 65 }, () => ({ dimensions: fields })), 'HQ_CLIENT_LIMIT');
});
it('pins exact UTF-8 and depth limits before shape validation', () => {
  const make = (size: number) => ({ extra: 'x'.repeat(size - 12) }); // {"extra":""} is twelve UTF-8 bytes.
  expect(() => validateProtocolClientContract(make(1_048_576))).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_VERSION' }));
  expect(() => validateProtocolClientContract(make(1_048_577))).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_LIMIT' }));
  let nested: unknown = 0;
  for (let i = 0; i < 15; i++) nested = [nested];
  expect(() => validateProtocolClientContract(nested)).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_SHAPE' }));
  expect(() => validateProtocolClientContract([nested])).toThrowError(expect.objectContaining({ code: 'HQ_CLIENT_LIMIT' }));
});
it('pins the portable timezone registry source', async () => {
  const { CLIENT_TIMEZONE_NAMES } = await import('./timezone-names.js');
  expect([...CLIENT_TIMEZONE_NAMES]).toEqual(readFileSync(new URL('timezone-names.txt', directory), 'utf8').trim().split('\n'));
});

it('accepts real contracts at the endpoint and total-descriptor ceilings', () => {
  const template = (unsigned(contracts.build).endpoints as Data[])[0];
  for (const [endpointCount, filterCount] of [[256, 0], [64, 255]]) {
    const endpoints = Array.from({ length: endpointCount }, (_, i) => ({ ...structuredClone(template),
      id: 'dataset' + i, dataset: 'dataset' + i, path: '/datasets/' + i,
      filters: Object.fromEntries(Array.from({ length: filterCount }, (_, j) => ['filter' + j, { type: 'boolean', operators: ['eq'] }])),
    }));
    const result = prepareProtocolClientContract({ kind: 'hypequery-client-contract', version: 1, view: 'build', endpoints });
    expect(result.contract.endpoints).toHaveLength(endpointCount);
    expect(validateProtocolClientContract(result.contract)).toEqual(result.contract);
  }
});
