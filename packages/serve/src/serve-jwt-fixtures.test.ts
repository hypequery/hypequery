/**
 * Runs the language-neutral JWT fixtures (specs/serve-http/fixtures/jwt-v1)
 * against `createJwtStrategy` and `createAnalyticsTokenIssuer`. The Python serve
 * runs the same file in `test_serve_jwt_fixtures.py`; a divergence is a bug.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAnalyticsTokenIssuer, createJwtStrategy } from './auth.js';
import { defineServe } from './server';
import type { AuthContext, AuthStrategy, ServeRequest } from './types.js';

interface Verifier {
  key: 'secret' | 'jwks';
  issuer?: string | string[];
  audience?: string | string[];
  algorithms?: string[];
}

interface Principal {
  subject: string;
  tenantId: string | null;
  roles: string[];
  scopes: string[];
}

interface Fixtures {
  secret: string;
  jwks: { keys: Record<string, unknown>[] };
  verifiers: Record<string, Verifier>;
  refusal: { status: number; type: string; message: string; details: Record<string, unknown> };
  issuer: {
    issuedAt: number;
    options: { issuer: string; audience: string; expiresInSeconds: number };
    claims: { subject: string; tenantId: string; roles: string[] };
    payload: Record<string, unknown>;
    tokens: { typescript: string; python: string };
  };
  accept: { id: string; verifier: string; token: string; principal: Principal }[];
  reject: { id: string; verifier: string; token: string }[];
}

const fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../specs/serve-http/fixtures/jwt-v1/cases.json', import.meta.url)),
    'utf8',
  ),
) as Fixtures;

let jwksServer: Server;
let jwksUri: string;
const strategies = new Map<string, AuthStrategy<AuthContext>>();

beforeAll(async () => {
  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixtures.jwks));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const address = jwksServer.address();
  if (!address || typeof address === 'string') throw new Error('JWKS server did not start');
  jwksUri = `http://127.0.0.1:${address.port}/jwks.json`;

  for (const [name, verifier] of Object.entries(fixtures.verifiers)) {
    const common = {
      issuer: verifier.issuer,
      audience: verifier.audience,
      algorithms: verifier.algorithms,
    };
    strategies.set(
      name,
      verifier.key === 'secret'
        ? createJwtStrategy({ secret: fixtures.secret, ...common })
        : createJwtStrategy({ jwksUri, ...common }),
    );
  }
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    jwksServer.close((error) => (error ? reject(error) : resolve()));
  });
});

const bearer = (token: string): ServeRequest => ({
  method: 'GET',
  path: '/whoami',
  query: {},
  headers: { authorization: `Bearer ${token}` },
});

const strategyFor = (name: string) => {
  const strategy = strategies.get(name);
  if (!strategy) throw new Error(`unknown verifier ${name}`);
  return strategy;
};

const principalOf = (auth: AuthContext | null): Principal => ({
  subject: auth?.userId as string,
  tenantId: (auth?.tenantId as string | undefined) ?? null,
  roles: [...(auth?.roles ?? [])].sort(),
  scopes: [...(auth?.scopes ?? [])].sort(),
});

/** A served API on one verifier, answering `/whoami` with the principal. */
const appFor = (name: string) => {
  const api = defineServe({
    basePath: '',
    auth: strategyFor(name),
    queries: {
      whoami: { query: async ({ ctx }) => principalOf(ctx.auth as AuthContext) },
    },
  });
  api.route('/whoami', api.queries.whoami, { method: 'GET' });
  return api;
};

describe('JWT fixtures (jwt-v1)', () => {
  describe('accepted', () => {
    it.each(fixtures.accept.map((fixture) => [fixture.id, fixture] as const))(
      '%s',
      async (_id, fixture) => {
        const auth = await strategyFor(fixture.verifier)({ request: bearer(fixture.token) });
        expect(principalOf(auth)).toEqual(fixture.principal);

        const response = await appFor(fixture.verifier).handler(bearer(fixture.token));
        expect(response.status).toBe(200);
        expect(response.body).toEqual(fixture.principal);
      },
    );
  });

  describe('refused', () => {
    it.each(fixtures.reject.map((fixture) => [fixture.id, fixture] as const))(
      '%s',
      async (_id, fixture) => {
        await expect(
          strategyFor(fixture.verifier)({ request: bearer(fixture.token) }),
        ).rejects.toMatchObject({ name: 'AuthError', reason: 'INVALID' });

        const response = await appFor(fixture.verifier).handler(bearer(fixture.token));
        const { refusal } = fixtures;
        const error = (response.body as { error: Record<string, unknown> }).error;
        expect(response.status).toBe(refusal.status);
        expect(error.type).toBe(refusal.type);
        expect(error.message).toBe(refusal.message);
        expect(error.details).toMatchObject(refusal.details);
      },
    );
  });

  describe('createAnalyticsTokenIssuer', () => {
    it('mints the fixture token at the fixture clock', async () => {
      const { options, claims, issuedAt, tokens, payload } = fixtures.issuer;
      vi.useFakeTimers({ now: issuedAt * 1000, toFake: ['Date'] });
      try {
        const issue = createAnalyticsTokenIssuer({
          secret: fixtures.secret,
          issuer: options.issuer,
          audience: options.audience,
          expiresIn: `${options.expiresInSeconds}s`,
        });
        const token = await issue({
          userId: claims.subject,
          tenantId: claims.tenantId,
          roles: claims.roles,
        });
        expect(token).toBe(tokens.typescript);
        // Both languages' tokens carry the same claims, in the same order.
        for (const minted of [tokens.typescript, tokens.python]) {
          const decoded = JSON.parse(Buffer.from(minted.split('.')[1], 'base64url').toString('utf8'));
          expect(decoded).toEqual(payload);
          expect(Object.keys(decoded)).toEqual(Object.keys(payload));
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
