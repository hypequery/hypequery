import { describe, expect, it } from 'vitest';
import {
  ProtocolBusinessContextError,
  encodeProtocolBusinessContextToString,
  hashProtocolBusinessContext,
  isEmptyProtocolBusinessContext,
  prepareProtocolBusinessContext,
  validateProtocolBusinessContext,
} from './index.js';

const header = { kind: 'hypequery-business-context', version: 1 } as const;

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProtocolBusinessContextError) return `${error.code} ${error.path}`;
    throw error;
  }
  return undefined;
}

describe('business context v1', () => {
  it('canonicalises field order, trims text and drops empty lists', () => {
    const canonical = encodeProtocolBusinessContextToString({
      glossary: [{ meaning: ' Paid in the last 30 days ', term: ' active customer ' }],
      goals: [],
      summary: '  Online grocery delivery.  ',
      ...header,
    });
    expect(canonical).toBe(
      '{"glossary":[{"meaning":"Paid in the last 30 days","term":"active customer"}],'
      + '"kind":"hypequery-business-context","summary":"Online grocery delivery.","version":1}',
    );
  });

  it('gives equal identity to inputs that differ only in canonical noise', () => {
    const a = hashProtocolBusinessContext({ ...header, summary: 'Shop', caveats: [] });
    const b = hashProtocolBusinessContext({ summary: ' Shop\n', ...header });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes identity when a glossary meaning changes', () => {
    const before = hashProtocolBusinessContext({
      ...header, glossary: [{ term: 'active customer', meaning: 'ordered in 30 days' }],
    });
    const after = hashProtocolBusinessContext({
      ...header, glossary: [{ term: 'active customer', meaning: 'ordered in 90 days' }],
    });
    expect(before).not.toBe(after);
  });

  it('accepts every Cloud onboarding field', () => {
    const context = validateProtocolBusinessContext({
      ...header,
      summary: 's',
      industry: 'i',
      businessModel: 'b',
      customers: 'c',
      audience: 'a',
      goals: ['g'],
      kpis: [{ name: 'GMV', definition: 'gross order value' }],
      glossary: [{ term: 't', meaning: 'm' }],
      conventions: 'USD, UTC',
      caveats: ['test orders exist'],
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(context.kpis?.[0]).toEqual({ name: 'GMV', definition: 'gross order value' });
  });

  it('treats a header-only document as empty', () => {
    expect(isEmptyProtocolBusinessContext(validateProtocolBusinessContext(header))).toBe(true);
    expect(isEmptyProtocolBusinessContext(
      validateProtocolBusinessContext({ ...header, industry: 'retail' }),
    )).toBe(false);
  });

  it('rejects malformed documents with stable codes and paths', () => {
    expect(code(() => validateProtocolBusinessContext({ ...header, version: 2 })))
      .toBe('HQ_BUSINESS_CONTEXT_INVALID_VERSION $.version');
    expect(code(() => validateProtocolBusinessContext({ version: 1 })))
      .toBe('HQ_BUSINESS_CONTEXT_TYPE $.kind');
    expect(code(() => validateProtocolBusinessContext({ ...header, memory: 'x' })))
      .toBe('HQ_BUSINESS_CONTEXT_UNKNOWN_FIELD $.memory');
    expect(code(() => validateProtocolBusinessContext({ ...header, summary: '   ' })))
      .toBe('HQ_BUSINESS_CONTEXT_INVALID_VALUE $.summary');
    expect(code(() => validateProtocolBusinessContext({ ...header, summary: 'a\u0000b' })))
      .toBe('HQ_BUSINESS_CONTEXT_INVALID_VALUE $.summary');
    expect(code(() => validateProtocolBusinessContext({ ...header, summary: '\uD800' })))
      .toBe('HQ_BUSINESS_CONTEXT_INVALID_VALUE $.summary');
    expect(code(() => validateProtocolBusinessContext({
      ...header, glossary: [{ term: 'x', meaning: 'y', source: 'chat' }],
    }))).toBe('HQ_BUSINESS_CONTEXT_UNKNOWN_FIELD $.glossary[0].source');
    expect(code(() => validateProtocolBusinessContext({
      ...header, kpis: [{ name: 'GMV' }],
    }))).toBe('HQ_BUSINESS_CONTEXT_TYPE $.kpis[0].definition');
  });

  it('rejects glossary terms and KPIs that collide ignoring case and spacing', () => {
    expect(code(() => validateProtocolBusinessContext({
      ...header,
      glossary: [
        { term: 'Active  Customer', meaning: 'a' },
        { term: 'active customer', meaning: 'b' },
      ],
    }))).toBe('HQ_BUSINESS_CONTEXT_DUPLICATE $.glossary[1].term');
    expect(code(() => validateProtocolBusinessContext({
      ...header,
      kpis: [{ name: 'GMV', definition: 'a' }, { name: 'gmv', definition: 'b' }],
    }))).toBe('HQ_BUSINESS_CONTEXT_DUPLICATE $.kpis[1].name');
  });

  it('enforces text, item and byte limits', () => {
    expect(code(() => validateProtocolBusinessContext({ ...header, summary: 'x'.repeat(4_097) })))
      .toBe('HQ_BUSINESS_CONTEXT_TOO_LARGE $.summary');
    expect(code(() => validateProtocolBusinessContext({
      ...header, goals: Array.from({ length: 101 }, (_, index) => `g${index}`),
    }))).toBe('HQ_BUSINESS_CONTEXT_TOO_MANY_ITEMS $.goals');
    expect(code(() => prepareProtocolBusinessContext(
      { ...header, summary: 'x'.repeat(200) },
      { limits: { maxBytes: 100 } },
    ))).toBe('HQ_BUSINESS_CONTEXT_TOO_LARGE $');
    expect(() => validateProtocolBusinessContext(header, { limits: { maxItems: 101 } }))
      .toThrow(RangeError);
  });

  it('rejects objects that are not plain data', () => {
    class Context { kind = 'hypequery-business-context'; version = 1; }
    expect(code(() => validateProtocolBusinessContext(new Context())))
      .toBe('HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT $');
    const getter = { ...header, get summary() { return 'x'; } };
    expect(code(() => validateProtocolBusinessContext(getter)))
      .toBe('HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT $');
  });
});
