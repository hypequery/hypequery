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
  error: string;
}

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
