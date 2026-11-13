import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AgentTokenError, mintAgentToken, type MintAgentTokenOptions } from '../src/index.js';
import { signingKeyAudience, verifySigningKeyJwt } from './ag18a-verifier.js';

/**
 * The language-neutral mint fixtures (specs/agent-token/fixtures/mint-v1).
 * `python/hypequery/tests/test_agent_mint_fixtures.py` runs the same file, so
 * both minters produce the same bytes and refuse the same inputs, and every
 * accepted token passes Cloud's verifier (AG-18a), ported in ./ag18a-verifier.
 */
interface AcceptedCase {
  readonly name: string;
  readonly now: number;
  readonly input: Record<string, unknown>;
  readonly token: string;
  readonly mcpUrl: string;
  readonly expiresAt: number;
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
}
interface RefusedCase {
  readonly name: string;
  readonly input?: Record<string, unknown>;
  readonly signingKey?: string;
  readonly field: string;
}
const fixture = JSON.parse(
  readFileSync(new URL('../../../specs/agent-token/fixtures/mint-v1/cases.json', import.meta.url), 'utf8'),
) as {
  signingKey: { kid: string; x: string };
  accepted: AcceptedCase[];
  refused: RefusedCase[];
};
const signingKey = JSON.stringify(fixture.signingKey);
const publicKey = { kid: fixture.signingKey.kid, publicKey: fixture.signingKey.x };
const BASE = {
  project: 'acme:logistics',
  endpoint: 'https://acme-logistics-1f2e3d4c.hypequery.app',
  tenant: 'northwind',
  subject: 'user_42',
  permissionSet: 'customers',
};

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/** A refused case's input: the base options with its patch, where null removes an option. */
function refusedOptions(entry: RefusedCase): MintAgentTokenOptions {
  const options: Record<string, unknown> = {
    ...BASE,
    ...entry.input,
    signingKey: entry.signingKey ?? signingKey,
    now: new Date(1_763_000_000_000),
  };
  for (const [key, value] of Object.entries(options)) if (value === null) delete options[key];
  return options as unknown as MintAgentTokenOptions;
}

describe('mint-v1 fixtures', () => {
  describe.each(fixture.accepted)('accepts: $name', (entry) => {
    it('mints the fixture token byte for byte', async () => {
      const minted = await mintAgentToken({
        ...(entry.input as unknown as MintAgentTokenOptions),
        signingKey,
        now: new Date(entry.now * 1_000),
      });
      expect(minted.token).toBe(entry.token);
      expect(minted.mcpUrl).toBe(entry.mcpUrl);
      expect(minted.expiresAt.getTime()).toBe(entry.expiresAt * 1_000);
      const [header, payload] = minted.token.split('.');
      expect(decode(header!)).toEqual(entry.header);
      expect(decode(payload!)).toEqual(entry.payload);
    });

    it('passes the AG-18a verifier for its whole lifetime, and not after', async () => {
      const audience = signingKeyAudience(String(entry.input.project));
      const payload = entry.payload as { iat: number; exp: number; constraints?: unknown };
      for (const seconds of [entry.now, payload.exp - 1]) {
        const claims = await verifySigningKeyJwt(entry.token, publicKey, audience, new Date(seconds * 1_000));
        expect(claims).toEqual({
          subject: entry.payload.sub,
          tenantId: entry.payload.tenant,
          permissionSetName: entry.payload.permission_set,
          constraints: payload.constraints ?? [],
        });
      }
      // Past `exp` and Cloud's 30-second clock tolerance.
      expect(
        await verifySigningKeyJwt(entry.token, publicKey, audience, new Date((payload.exp + 31) * 1_000)),
      ).toBeNull();
      expect(
        await verifySigningKeyJwt(entry.token, publicKey, signingKeyAudience('other:project'), new Date(entry.now * 1_000)),
      ).toBeNull();
    });
  });

  it.each(fixture.refused)('refuses: $name', async (entry) => {
    const failure = await mintAgentToken(refusedOptions(entry)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentTokenError);
    expect((failure as AgentTokenError).field).toBe(entry.field);
    expect((failure as Error).message).not.toContain((fixture.signingKey as { d?: string }).d);
  });
});
