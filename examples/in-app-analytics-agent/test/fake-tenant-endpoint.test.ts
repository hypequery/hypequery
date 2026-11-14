/**
 * The stand-in must refuse what Cloud refuses, or the isolation test proves
 * less than it says. These tokens are signed with the endpoint's own key, so
 * only the rule under test can refuse them.
 */
import { createHypequeryToolsClient, HypequeryToolsError } from '@hypequery/agent';
import { importJWK, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_SET, PROJECT, startFakeTenantEndpoint, TENANT_TOOLS, type FakeTenantEndpoint } from './fake-tenant-endpoint';
import { db } from './seed';

let endpoint: FakeTenantEndpoint;
let key: { kid: string; hq_endpoint: string } & Record<string, unknown>;

beforeAll(async () => {
  endpoint = await startFakeTenantEndpoint();
  key = JSON.parse(endpoint.signingKey);
});

afterAll(async () => {
  await endpoint?.close();
  await db.close();
});

/** A token with the given `iat` and `exp`, relative to now, in seconds. */
async function sign(issuedAgo: number, lifetime: number, claims: Record<string, unknown> = {}) {
  const issuedAt = Math.floor(Date.now() / 1_000) - issuedAgo;
  return new SignJWT({ tenant: '4', permission_set: PERMISSION_SET, ...claims })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: 'JWT' })
    .setAudience(`hypequery-agent:${PROJECT}`)
    .setSubject('ada')
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetime)
    .sign(await importJWK(key, 'EdDSA'));
}

async function listTools(token: string) {
  const client = createHypequeryToolsClient({ url: `${key.hq_endpoint}/mcp`, token });
  try {
    return await client.listTools();
  } finally {
    await client.close();
  }
}

async function refusal(token: string) {
  const error = await listTools(token).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HypequeryToolsError);
  return error as HypequeryToolsError;
}

describe('the fake tenant endpoint', () => {
  it('accepts a 15-minute token', async () => {
    const tools = await listTools(await sign(0, 900));
    expect(tools.map((tool) => tool.name)).toEqual(TENANT_TOOLS);
  });

  it('refuses a freshly issued token that lives longer than 15 minutes', async () => {
    const before = endpoint.verified.length;
    expect(await refusal(await sign(0, 901))).toMatchObject({ status: 401 });
    expect(await refusal(await sign(0, 3_600))).toMatchObject({ status: 401 });
    expect(endpoint.verified).toHaveLength(before);
  });

  it('refuses a token issued more than 15 minutes ago, and one for another permission set', async () => {
    expect(await refusal(await sign(1_000, 2_000))).toMatchObject({ status: 401 });
    expect(await refusal(await sign(0, 900, { permission_set: 'admins' }))).toMatchObject({ status: 401 });
  });
});
