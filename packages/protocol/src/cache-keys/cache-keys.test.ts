import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolCacheKeyError,
  deriveProtocolCacheKey,
  deriveProtocolCacheNamespaceToken,
} from './cache-keys.js';
import { PROTOCOL_CACHE_KEY_LIMITS } from './types.js';

interface SuccessFixture {
  id: string;
  secretHex: string;
  namespace: { project: string; environment: string };
  keyVersion: number;
  preimageUtf8: string;
  namespaceToken: string;
  key: string;
}

interface RejectionFixture {
  id: string;
  secretHex: string;
  namespace: { project: string; environment: string };
  keyVersion: number;
  preimageUtf8?: string;
  generator?: { type: string; utf8?: string; count?: number };
  error: string;
}

function readFixture<T>(name: string): T {
  const path = fileURLToPath(
    new URL(`../../../../specs/security-protocol/fixtures/cache-keys-v1/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function materializePreimage(fixture: RejectionFixture): string {
  if (fixture.generator?.type === 'repeat-string') {
    return (fixture.generator.utf8 ?? '').repeat(fixture.generator.count ?? 0);
  }
  return fixture.preimageUtf8 ?? '';
}

const success = readFixture<SuccessFixture[]>('success.json');
const rejections = readFixture<RejectionFixture[]>('rejections.json');

describe('cache key derivation', () => {
  // The fixture expectations were produced with node:crypto rather than the
  // @noble/hashes primitives used here, so agreement is cross-validation and
  // not a restatement of this implementation.
  it.each(success)('derives $id exactly', (fixture) => {
    const key = deriveProtocolCacheKey({
      secret: hexToBytes(fixture.secretHex),
      namespace: fixture.namespace,
      keyVersion: fixture.keyVersion,
      preimage: fixture.preimageUtf8,
    });
    expect(key).toBe(fixture.key);
  });

  it.each(success)('derives the namespace token for $id', (fixture) => {
    const token = deriveProtocolCacheNamespaceToken(
      hexToBytes(fixture.secretHex),
      fixture.namespace.project,
      fixture.namespace.environment,
    );
    expect(token).toBe(fixture.namespaceToken);
    expect(fixture.key.split('.')[2]).toBe(token);
  });

  it.each(rejections)('rejects $id with $error', (fixture) => {
    let thrown: unknown;
    try {
      deriveProtocolCacheKey({
        secret: hexToBytes(fixture.secretHex),
        namespace: fixture.namespace,
        keyVersion: fixture.keyVersion,
        preimage: materializePreimage(fixture),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProtocolCacheKeyError);
    expect((thrown as ProtocolCacheKeyError).code).toBe(fixture.error);
  });

  it('never leaks preimage content into the key', () => {
    const secret = new Uint8Array(32).fill(0x11);
    const secrets = ['ana@example.com', 'acme_corp', 'prod.orders', 'tenant_id'];
    const key = deriveProtocolCacheKey({
      secret,
      namespace: { project: 'acme', environment: 'production' },
      keyVersion: 1,
      preimage: JSON.stringify({ filters: secrets, tenant: { value: 'acme_corp' } }),
    });
    for (const value of secrets) expect(key).not.toContain(value);
  });

  it('produces a key of the pinned shape and bound', () => {
    const key = deriveProtocolCacheKey({
      secret: new Uint8Array(32).fill(0x11),
      namespace: { project: 'acme', environment: 'production' },
      keyVersion: 1,
      preimage: 'x',
    });
    expect(key).toMatch(/^hq1\.[1-9][0-9]*\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(new TextEncoder().encode(key).byteLength).toBeLessThanOrEqual(
      PROTOCOL_CACHE_KEY_LIMITS.maxStoreKeyBytes,
    );
  });

  it('separates namespaces even when the preimage is identical', () => {
    const secret = new Uint8Array(32).fill(0x11);
    const of = (project: string, environment: string) =>
      deriveProtocolCacheKey({
        secret,
        namespace: { project, environment },
        keyVersion: 1,
        preimage: 'same',
      });
    const keys = new Set([
      of('acme', 'production'),
      of('acme', 'staging'),
      of('globex', 'production'),
    ]);
    expect(keys.size).toBe(3);
  });

  it('keeps the error message free of the secret and preimage', () => {
    const secret = new Uint8Array(8).fill(0xab);
    try {
      deriveProtocolCacheKey({
        secret,
        namespace: { project: 'acme', environment: 'production' },
        keyVersion: 1,
        preimage: 'ana@example.com',
      });
      throw new Error('expected a failure');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe('HQ_CACHE_KEY_SECRET_TOO_SHORT');
      expect(message).not.toContain('ana@example.com');
      expect(message).not.toContain('ab');
    }
  });
});
