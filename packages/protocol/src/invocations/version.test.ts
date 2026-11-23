import { describe, expect, it } from 'vitest';
import { ProtocolSemanticInvocationError } from './errors.js';
import { semanticInvocation2Features, semanticInvocationVersion } from './version.js';
import { toSemanticInvocation, validateProtocolSemanticInvocationV2 } from './validate.js';
import type { ProtocolSemanticInvocationOperation } from './types.js';

const op = (fields: Record<string, unknown>) => ({ kind: 'dataset', dataset: 'orders', ...fields }) as unknown as ProtocolSemanticInvocationOperation;
const TARGET = { project: 'acme', environment: 'production' };

describe('semantic invocation version selection (RFC 0030)', () => {
  it.each([
    ['plain measures', op({ measures: ['revenue'] })],
    ['a day grain', op({ measures: ['revenue'], by: 'day' })],
    ['fill and timeKey', op({ measures: ['revenue'], by: 'week', fill: true, timeKey: 'shipped_at' })],
    ['having and timezone', op({ measures: ['revenue'], having: [{ measure: 'revenue', operator: 'gt', value: 1 }], timezone: 'Europe/Berlin' })],
    ['an or group', op({ filters: [{ kind: 'logical', operator: 'or', operands: [] }] })],
    ['a qualified dimension', op({ dimensions: ['customer.region'] })],
    ['an empty segments list', op({ segments: [] })],
    ['a funnel', { kind: 'funnel', dataset: 'events' } as unknown as ProtocolSemanticInvocationOperation],
    ['a metric query by hour-free grain', { kind: 'metric', dataset: 'orders', metric: 'm', by: 'month' } as unknown as ProtocolSemanticInvocationOperation],
  ])('selects invocation 1 for %s', (_name, operation) => {
    expect(semanticInvocationVersion(operation)).toBe(1);
    expect(semanticInvocation2Features(operation)).toEqual([]);
  });

  it.each([
    ['segments', op({ segments: ['paid'] }), ['segments']],
    ['a minute grain', op({ by: 'minute' }), ['subDayGrain']],
    ['an hour grain on a metric', { kind: 'metric', dataset: 'orders', metric: 'm', by: 'hour' } as unknown as ProtocolSemanticInvocationOperation, ['subDayGrain']],
    ['a relationship measure', op({ measures: ['customer.customerCount'] }), ['relationshipMeasures']],
    ['calculations', op({ calculations: [{ name: 'r', rank: { measure: 'revenue' } }] }), ['calculations']],
    ['limitBy', op({ limitBy: { n: 2, by: ['status'] } }), ['limitBy']],
    ['other', op({ other: { dimension: 'status', n: 3, measure: 'revenue' } }), ['other']],
    ['everything, in order', op({
      segments: ['paid'], by: 'hour', measures: ['customer.count'], calculations: [{}], limitBy: {}, other: {},
    }), ['segments', 'subDayGrain', 'relationshipMeasures', 'calculations', 'limitBy', 'other']],
  ])('selects invocation 2 for %s', (_name, operation, expected) => {
    expect(semanticInvocationVersion(operation)).toBe(2);
    expect(semanticInvocation2Features(operation)).toEqual(expected);
  });

  it('only counts calculation fields on dataset queries', () => {
    const metric = { kind: 'metric', dataset: 'orders', metric: 'm', calculations: [{}], limitBy: {}, measures: ['a.b'] } as unknown as ProtocolSemanticInvocationOperation;
    expect(semanticInvocationVersion(metric)).toBe(1);
  });

  it('wraps an operation in a validated invocation at the lowest version', () => {
    const v1 = toSemanticInvocation(op({ measures: ['revenue'], by: 'day' }), { target: TARGET });
    expect(v1).toEqual({ kind: 'hypequery-semantic-invocation', version: 1, target: TARGET, operation: { kind: 'dataset', dataset: 'orders', measures: ['revenue'], by: 'day' } });
    const v2 = toSemanticInvocation(op({ measures: ['revenue'], by: 'hour' }), {
      target: TARGET, activationRevision: 'a'.repeat(64), budget: { maxRows: 10 }, correlationId: 'req-1',
    });
    expect(v2).toMatchObject({ version: 2, activationRevision: 'a'.repeat(64), budget: { maxRows: 10 }, correlationId: 'req-1' });
    expect(validateProtocolSemanticInvocationV2(v2)).toEqual(v2);
    expect(Object.isFrozen(v2)).toBe(true);
  });

  it('still validates what it wraps', () => {
    expect(() => toSemanticInvocation(op({ measures: ['revenue'], bogus: true }), { target: TARGET }))
      .toThrow(ProtocolSemanticInvocationError);
    expect(() => toSemanticInvocation(op({ measures: ['revenue'] }), { target: { project: '', environment: 'x' } }))
      .toThrow(ProtocolSemanticInvocationError);
  });
});
