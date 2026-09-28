import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolCachePreimageError,
  buildProtocolCachePreimage,
  deriveProtocolTenantFingerprint,
} from './cache-preimages.js';
import type { ProtocolCacheTenantScope } from './types.js';

interface Fixture {
  id: string;
  secretHex: string;
  definitionIdentity: string;
  query: unknown;
  tenant: ProtocolCacheTenantScope;
  rowLimit: number | null;
  preimageUtf8?: string;
  error?: string;
}

const fixturesDir = fileURLToPath(
  new URL('../../../../specs/security-protocol/fixtures/cache-preimages-v1/', import.meta.url),
);
const load = (name: string): Fixture[] =>
  JSON.parse(readFileSync(`${fixturesDir}${name}`, 'utf8')) as Fixture[];

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

const build = (fixture: Fixture): string =>
  buildProtocolCachePreimage({
    secret: hexToBytes(fixture.secretHex),
    definitionIdentity: fixture.definitionIdentity,
    query: fixture.query,
    tenant: fixture.tenant,
    rowLimit: fixture.rowLimit,
  });

describe('cache-preimages-v1 fixtures', () => {
  it.each(load('success.json'))('$id builds the exact preimage', (fixture) => {
    expect(build(fixture)).toBe(fixture.preimageUtf8);
  });

  it.each(load('rejections.json'))('$id reports $error', (fixture) => {
    let caught: unknown;
    try {
      build(fixture);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProtocolCachePreimageError);
    expect((caught as ProtocolCachePreimageError).code).toBe(fixture.error);
    expect((caught as Error).message).toBe(fixture.error);
  });
});

describe('deriveProtocolTenantFingerprint', () => {
  const secret = new Uint8Array(32).fill(0x11);

  it('matches the fingerprints inside a scoped preimage', () => {
    const preimage = JSON.parse(
      buildProtocolCachePreimage({
        secret,
        definitionIdentity: 'a'.repeat(64),
        query: { kind: 'dataset', dataset: 'orders' },
        tenant: { mode: 'scoped', ids: ['acme'] },
        rowLimit: null,
      }),
    ) as { tenant: { fingerprints: string[] } };
    expect(preimage.tenant.fingerprints).toEqual([deriveProtocolTenantFingerprint(secret, 'acme')]);
  });

  it('never returns the raw identifier and fails closed without a secret', () => {
    expect(deriveProtocolTenantFingerprint(secret, 'acme')).toMatch(/^[0-9a-f]{64}$/);
    expect(() => deriveProtocolTenantFingerprint(new Uint8Array(), 'acme')).toThrow(
      'HQ_CACHE_PREIMAGE_SECRET_MISSING',
    );
  });
});
