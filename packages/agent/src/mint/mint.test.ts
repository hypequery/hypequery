import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT, importJWK } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signingKeyAudience, verifySigningKeyJwt } from '../../test/ag18a-verifier.js';
import {
  AGENT_TOKEN_MAX_LIFETIME_SECONDS,
  AgentTokenError,
  agentTokenAudience,
  mintAgentToken,
} from '../index.js';

/** A key exactly as Cloud's `generateSigningKey()` (AG-18a) produces it. */
function cloudSigningKey() {
  const kid = `hqsk_${randomBytes(16).toString('base64url')}`;
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  return {
    kty: 'OKP' as const,
    crv: 'Ed25519' as const,
    x: jwk.x!,
    d: jwk.d!,
    kid,
    alg: 'EdDSA' as const,
    use: 'sig' as const,
  };
}

const key = cloudSigningKey();
const publicKey = { kid: key.kid, publicKey: key.x };
const options = {
  signingKey: JSON.stringify(key),
  project: 'acme:logistics',
  endpoint: 'https://acme-logistics-1f2e3d4c.hypequery.app',
  tenant: 'northwind',
  subject: 'user_42',
  permissionSet: 'customers',
};
const audience = signingKeyAudience('acme:logistics');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mintAgentToken', () => {
  it('mints a token the AG-18a verifier accepts now, with no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = Math.floor(Date.now() / 1_000);
    const { token, mcpUrl, expiresAt } = await mintAgentToken(options);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mcpUrl).toBe('https://acme-logistics-1f2e3d4c.hypequery.app/mcp');
    expect(Math.floor(expiresAt.getTime() / 1_000) - before).toBeGreaterThanOrEqual(900);
    expect(Math.floor(expiresAt.getTime() / 1_000) - before).toBeLessThanOrEqual(901);
    expect(await verifySigningKeyJwt(token, publicKey, audience)).toEqual({
      subject: 'user_42',
      tenantId: 'northwind',
      permissionSetName: 'customers',
      constraints: [],
    });
  });

  it('takes the key as a parsed JWK too, and ignores members it does not use', async () => {
    const now = new Date('2026-11-13T12:00:00Z');
    const fromString = await mintAgentToken({ ...options, now });
    const fromObject = await mintAgentToken({
      ...options,
      signingKey: { ...key, key_ops: ['sign'] } as typeof key,
      now,
    });
    expect(fromObject.token).toBe(fromString.token);
  });

  it('carries constraints the verifier reads back', async () => {
    const constraints = [
      { filter: 'region', operator: 'in', value: ['emea', 'apac'] },
      { filter: 'carrier_id', operator: 'eq', value: 7 },
    ] as const;
    const { token } = await mintAgentToken({ ...options, constraints });
    expect((await verifySigningKeyJwt(token, publicKey, audience))?.constraints).toEqual(constraints);
  });

  it('caps the lifetime at Cloud\'s 15 minutes', async () => {
    expect(AGENT_TOKEN_MAX_LIFETIME_SECONDS).toBe(900);
    const now = new Date('2026-11-13T12:00:00Z');
    const { expiresAt } = await mintAgentToken({ ...options, expiresInSeconds: 60, now });
    expect(expiresAt.getTime() - now.getTime()).toBe(60_000);
    await expect(mintAgentToken({ ...options, expiresInSeconds: 901 })).rejects.toMatchObject({
      field: 'expiresInSeconds',
    });
  });

  it('names its audience after the project protocol name', () => {
    expect(agentTokenAudience('acme:logistics')).toBe('hypequery-agent:acme:logistics');
    expect(() => agentTokenAudience('acme/logistics')).toThrow(AgentTokenError);
  });

  it('refuses a lone surrogate in a constraint value', async () => {
    await expect(
      mintAgentToken({
        ...options,
        constraints: [{ filter: 'city', operator: 'eq', value: 'a\uD800' }],
      }),
    ).rejects.toMatchObject({ field: 'constraints' });
  });

  it('refuses a sparse in list rather than sending null', async () => {
    const value = ['a', , 'b'] as unknown as string[];
    await expect(
      mintAgentToken({ ...options, constraints: [{ filter: 'city', operator: 'in', value }] }),
    ).rejects.toMatchObject({ field: 'constraints' });
  });

  it('refuses an invalid issue time', async () => {
    await expect(mintAgentToken({ ...options, now: new Date(Number.NaN) })).rejects.toMatchObject({
      field: 'now',
    });
  });

  it('never puts the private key in an error', async () => {
    const failure = await mintAgentToken({
      ...options,
      signingKey: JSON.stringify({ ...key, x: cloudSigningKey().x }),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentTokenError);
    expect(String((failure as Error).message)).not.toContain(key.d);
  });
});

describe('the ported AG-18a verifier', () => {
  // These keep the port honest: each token breaks one of Cloud's rules.
  const now = new Date('2026-11-13T12:00:00Z');
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const claims = { sub: 'user_42', tenant: 'northwind', permission_set: 'customers' };

  async function sign(
    payload: Record<string, unknown>,
    header: Record<string, unknown> = { alg: 'EdDSA', kid: key.kid },
  ) {
    const signer = await importJWK(key, 'EdDSA');
    return new SignJWT(payload).setProtectedHeader(header as { alg: string }).sign(signer);
  }

  it('accepts a well-formed token', async () => {
    const token = await sign({ ...claims, aud: audience, iat: nowSeconds, exp: nowSeconds + 900 });
    expect(await verifySigningKeyJwt(token, publicKey, audience, now)).not.toBeNull();
  });

  it.each([
    ['a lifetime over 15 minutes', { aud: audience, iat: nowSeconds, exp: nowSeconds + 901 }],
    ['a future iat', { aud: audience, iat: nowSeconds + 31, exp: nowSeconds + 300 }],
    ['another audience', { aud: 'hypequery-agent:other', iat: nowSeconds, exp: nowSeconds + 60 }],
    ['no permission set', { aud: audience, iat: nowSeconds, exp: nowSeconds + 60, permission_set: undefined }],
    ['no iat', { aud: audience, exp: nowSeconds + 60 }],
    [
      'malformed constraints',
      { aud: audience, iat: nowSeconds, exp: nowSeconds + 60, constraints: [{ filter: 'x', operator: 'gt', value: 1 }] },
    ],
  ])('refuses %s', async (_name, patch) => {
    const payload: Record<string, unknown> = { ...claims, ...patch };
    for (const [name, value] of Object.entries(payload)) if (value === undefined) delete payload[name];
    expect(await verifySigningKeyJwt(await sign(payload), publicKey, audience, now)).toBeNull();
  });

  it('refuses a token naming another key', async () => {
    const token = await sign(
      { ...claims, aud: audience, iat: nowSeconds, exp: nowSeconds + 60 },
      { alg: 'EdDSA', kid: cloudSigningKey().kid },
    );
    expect(await verifySigningKeyJwt(token, publicKey, audience, now)).toBeNull();
  });

  it('refuses a symmetric algorithm', async () => {
    const token = await new SignJWT({ ...claims, aud: audience, iat: nowSeconds, exp: nowSeconds + 60 })
      .setProtectedHeader({ alg: 'HS256', kid: key.kid })
      .sign(new TextEncoder().encode(key.x));
    expect(await verifySigningKeyJwt(token, publicKey, audience, now)).toBeNull();
  });
});

describe('project and endpoint from the key', () => {
  const keyWithTarget = JSON.stringify({
    ...key,
    hq_project: 'acme:logistics',
    hq_endpoint: 'https://acme-logistics-1f2e3d4c.hypequery.app',
  });

  it('mints with only the key, tenant, subject and permission set', async () => {
    const { token, mcpUrl } = await mintAgentToken({
      signingKey: keyWithTarget,
      tenant: 'northwind',
      subject: 'user_42',
      permissionSet: 'customers',
    });
    expect(mcpUrl).toBe('https://acme-logistics-1f2e3d4c.hypequery.app/mcp');
    expect(await verifySigningKeyJwt(token, publicKey, audience)).not.toBeNull();
  });

  it('lets explicit options win', async () => {
    const { token, mcpUrl } = await mintAgentToken({
      signingKey: keyWithTarget,
      project: 'acme:other',
      endpoint: 'https://acme-other.hypequery.app',
      tenant: 'northwind',
      subject: 'user_42',
      permissionSet: 'customers',
    });
    expect(mcpUrl).toBe('https://acme-other.hypequery.app/mcp');
    expect(await verifySigningKeyJwt(token, publicKey, signingKeyAudience('acme:other'))).not.toBeNull();
    expect(await verifySigningKeyJwt(token, publicKey, audience)).toBeNull();
  });

  it('names the missing option when neither gives it', async () => {
    const { project: _project, ...withoutProject } = options;
    await expect(mintAgentToken(withoutProject)).rejects.toMatchObject({ field: 'project' });
    const { endpoint: _endpoint, ...withoutEndpoint } = options;
    await expect(mintAgentToken(withoutEndpoint)).rejects.toMatchObject({ field: 'endpoint' });
  });
});
