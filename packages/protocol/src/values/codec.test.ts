import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolValueError,
  decodeCanonicalValue,
  encodeCanonicalValue,
  encodeCanonicalValueToString,
  hashCanonicalValue,
  validateCanonicalValue,
} from './index.js';

interface SuccessFixture {
  id: string;
  value: unknown;
  canonicalHex: string;
  sha256: string;
}

interface RejectionFixture {
  id: string;
  sourceUtf8?: string;
  value?: unknown;
  generator?: {
    type: string;
    depth?: number;
    leaf?: unknown;
    items?: number;
    value?: unknown;
    utf8?: string;
    count?: number;
    branches?: number;
    itemsPerBranch?: number;
  };
  declaredClickHouseType?: string;
  error: string;
}

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/tagged-values-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function arrayValue(values: unknown[]): unknown {
  return { $hypequery: { type: 'array', version: 1, values } };
}

function generateRejection(generator: NonNullable<RejectionFixture['generator']>): unknown {
  switch (generator.type) {
    case 'nested-array': {
      let value = generator.leaf;
      for (let depth = 0; depth < (generator.depth ?? 0); depth += 1) {
        value = arrayValue([value]);
      }
      return value;
    }
    case 'array': return arrayValue(
      Array.from({ length: generator.items ?? 0 }, () => generator.value),
    );
    case 'array-tree': return arrayValue(
      Array.from(
        { length: generator.branches ?? 0 },
        () => arrayValue(
          Array.from(
            { length: generator.itemsPerBranch ?? 0 },
            () => generator.value,
          ),
        ),
      ),
    );
    case 'non-finite-float': {
      if (generator.value === 'NaN') return Number.NaN;
      if (generator.value === 'Infinity') return Number.POSITIVE_INFINITY;
      if (generator.value === '-Infinity') return Number.NEGATIVE_INFINITY;
      throw new Error(`Unknown non-finite float: ${String(generator.value)}`);
    }
    case 'repeat-string': return (generator.utf8 ?? '').repeat(generator.count ?? 0);
    default: throw new Error(`Unknown fixture generator: ${generator.type}`);
  }
}

function expectProtocolError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected protocol operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolValueError);
    expect((error as ProtocolValueError).code).toBe(code);
    expect((error as Error).message).not.toContain('region');
  }
}

describe('canonical value codec', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it.each(success)('$id matches canonical bytes, hash, and decode fixtures', (fixture) => {
    const bytes = encodeCanonicalValue(fixture.value);
    expect(Buffer.from(bytes).toString('hex')).toBe(fixture.canonicalHex);
    expect(encodeCanonicalValueToString(fixture.value))
      .toBe(Buffer.from(fixture.canonicalHex, 'hex').toString('utf8'));
    expect(hashCanonicalValue(fixture.value)).toBe(fixture.sha256);
    expect(decodeCanonicalValue(bytes)).toEqual(fixture.value);
  });

  it.each(rejections)('rejects $id with its stable code', (fixture) => {
    const action = fixture.sourceUtf8 !== undefined
      ? () => decodeCanonicalValue(fixture.sourceUtf8 as string)
      : () => validateCanonicalValue(
        fixture.generator ? generateRejection(fixture.generator) : fixture.value,
        { declaredClickHouseType: fixture.declaredClickHouseType },
      );
    expectProtocolError(action, fixture.error);
  });

  it('returns a detached deeply frozen snapshot', () => {
    const input = arrayValue(['original']) as {
      $hypequery: { values: string[] };
    };
    const value = validateCanonicalValue(input) as {
      readonly $hypequery: { readonly values: readonly string[] };
    };

    input.$hypequery.values[0] = 'changed';
    expect(value.$hypequery.values[0]).toBe('original');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.$hypequery)).toBe(true);
    expect(Object.isFrozen(value.$hypequery.values)).toBe(true);
  });

  it('never invokes getters or toJSON', () => {
    let getterCalls = 0;
    let toJsonCalls = 0;
    const getterInput = Object.defineProperty({}, '$hypequery', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { type: 'uuid', version: 1, value: '01890f3e-7b7b-7cc2-98c4-dc0c0c07398f' };
      },
    });
    const serializerInput = {
      toJSON() {
        toJsonCalls += 1;
        return null;
      },
    };

    expectProtocolError(
      () => validateCanonicalValue(getterInput),
      'HQ_VALUE_UNSAFE_OBJECT',
    );
    expectProtocolError(
      () => validateCanonicalValue(serializerInput),
      'HQ_VALUE_UNSAFE_OBJECT',
    );
    expect(getterCalls).toBe(0);
    expect(toJsonCalls).toBe(0);
  });

  it('snapshots proxy data without invoking value get traps', () => {
    let getCalls = 0;
    const input = new Proxy(
      { $hypequery: { type: 'integer', version: 1, bits: 8, signed: true, value: '1' } },
      {
        get(target, property, receiver) {
          getCalls += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    expect(encodeCanonicalValueToString(input)).toContain('integer');
    expect(getCalls).toBe(0);
  });

  it('rejects sparse arrays, symbols, custom prototypes, and cycles', () => {
    const sparse = arrayValue(new Array(1));
    const symbol = arrayValue([null]) as Record<PropertyKey, unknown>;
    symbol[Symbol('hidden')] = true;
    const custom = Object.create({ inherited: true }) as Record<string, unknown>;
    custom.$hypequery = { type: 'array', version: 1, values: [] };
    const cyclic = arrayValue([]) as { $hypequery: { values: unknown[] } };
    cyclic.$hypequery.values.push(cyclic);

    expectProtocolError(() => validateCanonicalValue(sparse), 'HQ_VALUE_INVALID_FORMAT');
    expectProtocolError(() => validateCanonicalValue(symbol), 'HQ_VALUE_UNSAFE_OBJECT');
    expectProtocolError(() => validateCanonicalValue(custom), 'HQ_VALUE_UNSAFE_OBJECT');
    expectProtocolError(() => validateCanonicalValue(cyclic), 'HQ_VALUE_INVALID_FORMAT');
  });

  it('supports lower product limits but rejects attempts to raise protocol limits', () => {
    expectProtocolError(
      () => validateCanonicalValue('12345', { limits: { maxStringBytes: 4 } }),
      'HQ_VALUE_TOO_LARGE',
    );
    expect(() => validateCanonicalValue(null, { limits: { maxDepth: 17 } }))
      .toThrow(RangeError);
  });

  it('rejects duplicate keys at nested depths before object construction', () => {
    expectProtocolError(
      () => decodeCanonicalValue(
        '{"$hypequery":{"type":"tuple","version":1,"values":[{"a":1,"a":2}]}}',
      ),
      'HQ_VALUE_DUPLICATE_KEY',
    );
  });

  it('rejects invalid UTF-8 byte input', () => {
    expectProtocolError(
      () => decodeCanonicalValue(Uint8Array.from([0xc3, 0x28])),
      'HQ_VALUE_INVALID_UNICODE',
    );
  });
});
