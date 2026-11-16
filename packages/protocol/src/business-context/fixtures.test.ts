import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolBusinessContextError,
  isEmptyProtocolBusinessContext,
  prepareProtocolBusinessContext,
  validateProtocolBusinessContext,
} from './index.js';
import type { ProtocolBusinessContextLimits } from './types.js';

interface SuccessFixture { id: string; value: unknown; empty: boolean }
interface RejectionFixture {
  id: string;
  value: unknown;
  limits?: Partial<ProtocolBusinessContextLimits>;
  error: string;
  path: string;
}
interface IdentityFixture { id: string; canonical: string; sha256: string }

const FAILURE_CODES = [
  'HQ_BUSINESS_CONTEXT_TYPE',
  'HQ_BUSINESS_CONTEXT_UNKNOWN_FIELD',
  'HQ_BUSINESS_CONTEXT_INVALID_VERSION',
  'HQ_BUSINESS_CONTEXT_INVALID_VALUE',
  'HQ_BUSINESS_CONTEXT_DUPLICATE',
  'HQ_BUSINESS_CONTEXT_TOO_MANY_ITEMS',
  'HQ_BUSINESS_CONTEXT_TOO_LARGE',
] as const;

function readFixture<T>(name: string): T {
  const fixturePath = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/business-context-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

describe('shared business context v1 fixtures', () => {
  // Python's `hypequery.protocol` runs the same files and must reach the same
  // canonical bytes, identities, codes and paths.
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');
  const identities = readFixture<IdentityFixture[]>('identity.json');

  it('has unique ids, an identity per success case, and every JSON-reachable code', () => {
    const ids = [...success, ...rejections].map(fixture => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(identities.map(fixture => fixture.id)).toEqual(success.map(fixture => fixture.id));
    // HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT needs a host object JSON cannot describe.
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...FAILURE_CODES].sort());
  });

  it.each(identities)('$id matches canonical bytes and identity', fixture => {
    const source = success.find(candidate => candidate.id === fixture.id);
    expect(source).toBeDefined();
    const prepared = prepareProtocolBusinessContext(source?.value);
    expect(prepared.canonical).toBe(fixture.canonical);
    expect(new TextDecoder().decode(prepared.bytes)).toBe(fixture.canonical);
    expect(prepared.identity).toBe(fixture.sha256);
    expect(isEmptyProtocolBusinessContext(prepared.context)).toBe(source?.empty);
  });

  it.each(rejections)('rejects $id with its code and path', fixture => {
    const options = fixture.limits ? { limits: fixture.limits } : {};
    let failure: string | undefined;
    try {
      prepareProtocolBusinessContext(fixture.value, options);
    } catch (error) {
      if (!(error instanceof ProtocolBusinessContextError)) throw error;
      failure = `${error.code} ${error.path}`;
    }
    expect(failure).toBe(`${fixture.error} ${fixture.path}`);
    if (fixture.path !== '$' || fixture.error !== 'HQ_BUSINESS_CONTEXT_TOO_LARGE') {
      // Every failure but the canonical byte limit is a validation failure.
      expect(() => validateProtocolBusinessContext(fixture.value, options))
        .toThrow(ProtocolBusinessContextError);
    }
  });
});
