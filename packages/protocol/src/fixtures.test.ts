import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface SuccessFixture {
  id: string;
  value: unknown;
  canonicalHex: string;
  sha256: string;
}

interface RejectionFixture {
  id: string;
  phase: string;
  sourceUtf8?: string;
  value?: unknown;
  generator?: Record<string, unknown>;
  declaredClickHouseType?: string;
  error: string;
}

const STABLE_FAILURE_CODES = [
  'HQ_VALUE_INVALID_JSON',
  'HQ_VALUE_DUPLICATE_KEY',
  'HQ_VALUE_INVALID_UNICODE',
  'HQ_VALUE_CONTROL_CHARACTER',
  'HQ_VALUE_NON_FINITE_FLOAT',
  'HQ_VALUE_NEGATIVE_ZERO',
  'HQ_VALUE_INTEGER_TAG_REQUIRED',
  'HQ_VALUE_RAW_COMPOSITE',
  'HQ_VALUE_UNKNOWN_TAG',
  'HQ_VALUE_UNKNOWN_TAG_VERSION',
  'HQ_VALUE_UNKNOWN_FIELD',
  'HQ_VALUE_INVALID_FORMAT',
  'HQ_VALUE_OUT_OF_RANGE',
  'HQ_VALUE_TYPE_MISMATCH',
  'HQ_VALUE_TOO_DEEP',
  'HQ_VALUE_TOO_MANY_NODES',
  'HQ_VALUE_TOO_MANY_ITEMS',
  'HQ_VALUE_TOO_LARGE',
] as const;

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../specs/security-protocol/fixtures/tagged-values-v1/${name}`,
    import.meta.url,
  ));

  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// Fixture-integrity helper only. The production JCS implementation belongs to
// R1A-03 and must not reuse this deliberately small test implementation.
function canonicalizeFixtureValue(value: unknown): string {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
    || typeof value === 'number'
  ) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError('Fixture contains a non-JSON scalar');
    }
    return encoded;
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeFixtureValue).join(',')}]`;
  }

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      // Default JS string ordering compares UTF-16 code units, as RFC 8785 requires.
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeFixtureValue(object[key])}`)
      .join(',')}}`;
  }

  throw new TypeError('Fixture contains a non-JSON value');
}

describe('tagged value v1 fixture integrity', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it('contains unique stable fixture identifiers', () => {
    const ids = [...success, ...rejections].map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every stable RFC failure code', () => {
    const coveredCodes = new Set(rejections.map((fixture) => fixture.error));

    expect([...coveredCodes].sort()).toEqual([...STABLE_FAILURE_CODES].sort());
  });

  it.each(success)('$id has exact canonical bytes and SHA-256', (fixture) => {
    const canonical = canonicalizeFixtureValue(fixture.value);
    const canonicalBytes = Buffer.from(canonical, 'utf8');

    expect(canonicalBytes.toString('hex')).toBe(fixture.canonicalHex);
    expect(createHash('sha256').update(canonicalBytes).digest('hex'))
      .toBe(fixture.sha256);
    expect(JSON.parse(canonicalBytes.toString('utf8'))).toEqual(fixture.value);
  });

  it('proves Unicode normalization is not performed', () => {
    const composed = success.find((fixture) => fixture.id === 'unicode-composed');
    const decomposed = success.find((fixture) => fixture.id === 'unicode-decomposed');

    expect(composed?.sha256).toBeDefined();
    expect(decomposed?.sha256).toBeDefined();
    expect(composed?.sha256).not.toBe(decomposed?.sha256);
  });

  it('sorts object keys by UTF-16 code units', () => {
    const supplementaryKey = '\u{10000}';
    const bmpKey = '\uE000';

    expect(canonicalizeFixtureValue({ [bmpKey]: 1, [supplementaryKey]: 2 }))
      .toBe(`{"${supplementaryKey}":2,"${bmpKey}":1}`);
  });

  it.each(rejections)('$id declares one input form and a stable error', (fixture) => {
    const inputs = [
      fixture.sourceUtf8 !== undefined,
      fixture.value !== undefined,
      fixture.generator !== undefined,
    ].filter(Boolean);

    expect(inputs).toHaveLength(1);
    expect(fixture.error).toMatch(/^HQ_VALUE_[A-Z0-9_]+$/);
    expect(fixture.phase).toMatch(/^(parse|unicode|model|limits)$/);
  });
});
