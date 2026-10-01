/**
 * Runs the language-neutral serve HTTP error fixtures (specs/serve-http) against
 * `defineServe`. The Python serve runs the same file; a divergence is a bug.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AuthError, createBearerTokenStrategy } from './auth.js';
import { MemoryRateLimitStore, rateLimit, type RateLimitStore } from './rate-limit.js';
import { defineServe } from './server';
import type { ServeRequest, ServeResponse } from './types.js';

interface FixtureRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  credential: 'none' | 'valid' | 'invalid';
  json?: unknown;
  expectStatus?: number;
}

interface FixtureCase {
  id: string;
  requests: FixtureRequest[];
  expect: {
    status: number;
    type: string;
    message: string;
    details?: Record<string, unknown>;
    noDetails?: boolean;
    issuePaths?: unknown[][];
    headers?: Record<string, string>;
  };
}

interface Fixtures {
  app: { credential: string };
  envelope: {
    requestIdHeader: string;
    requiredHeaders: Record<string, string>;
    bodyKeys: string[];
    errorKeys: string[];
    allowedDetailKeys: string[];
  };
  leakCanary: string;
  leakMarkers: string[];
  cases: FixtureCase[];
}

const fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../specs/serve-http/fixtures/errors-v1/cases.json', import.meta.url),
    ),
    'utf8',
  ),
) as Fixtures;

const stores: MemoryRateLimitStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.destroy();
});

const failingStore: RateLimitStore = {
  increment: async () => {
    throw new Error('store offline');
  },
  getTtl: async () => 0,
  reset: async () => undefined,
};

/** The fixture app described in cases.json, built fresh for each case. */
const buildApp = () => {
  const store = new MemoryRateLimitStore();
  stores.push(store);
  const keyByCaller = (ctx: { auth: Record<string, unknown> | null }) =>
    String(ctx.auth?.userId ?? 'anonymous');

  const api = defineServe({
    basePath: '',
    auth: createBearerTokenStrategy({
      // A presented but rejected token is INVALID; returning null would read
      // as "no credential" and report missing_credentials.
      validate: (token) => {
        if (token !== fixtures.app.credential) throw new AuthError('INVALID', 'Invalid token');
        return { userId: 'alice' };
      },
    }),
    queries: {
      protected: { query: async () => ({ ok: true }) },
      validated: {
        inputSchema: z.object({ limit: z.number() }),
        query: async ({ input }) => input,
      },
      boom: {
        query: async () => {
          throw new Error(fixtures.leakCanary);
        },
      },
      limited: {
        middlewares: [rateLimit({ windowMs: 60_000, max: 1, store, keyBy: keyByCaller })],
        query: async () => ({ ok: true }),
      },
      limiterDown: {
        middlewares: [
          rateLimit({ store: failingStore, failOpen: false, keyBy: keyByCaller }),
        ],
        query: async () => ({ ok: true }),
      },
    },
  });

  api.route('/protected', api.queries.protected, { method: 'GET' });
  api.route('/validated', api.queries.validated, { method: 'POST' });
  api.route('/boom', api.queries.boom, { method: 'GET' });
  api.route('/limited', api.queries.limited, { method: 'GET' });
  api.route('/limiter-down', api.queries.limiterDown, { method: 'GET' });
  return api;
};

const toServeRequest = (request: FixtureRequest): ServeRequest => {
  const headers: Record<string, string> = {};
  if (request.credential === 'valid') {
    headers.authorization = `Bearer ${fixtures.app.credential}`;
  } else if (request.credential === 'invalid') {
    headers.authorization = `Bearer ${fixtures.app.credential}-wrong`;
  }
  if (request.json !== undefined) headers['content-type'] = 'application/json';
  return {
    method: request.method,
    path: request.path,
    headers,
    query: {},
    ...(request.json !== undefined ? { body: request.json } : {}),
  };
};

const header = (response: ServeResponse, name: string): string | undefined => {
  const entry = Object.entries(response.headers ?? {}).find(
    ([key]) => key.toLowerCase() === name,
  );
  return entry?.[1];
};

describe('serve HTTP error fixtures (errors-v1)', () => {
  it.each(fixtures.cases.map((fixture) => [fixture.id, fixture] as const))(
    '%s',
    async (_id, fixture) => {
      const api = buildApp();
      let response: ServeResponse | undefined;
      for (const request of fixture.requests) {
        response = await api.handler(toServeRequest(request));
        if (request.expectStatus !== undefined) {
          expect(response.status).toBe(request.expectStatus);
        }
      }
      if (!response) throw new Error(`fixture ${fixture.id} sends no request`);

      const { envelope } = fixtures;
      const body = response.body as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      // The envelope, identical for every error.
      expect(Object.keys(body)).toEqual(envelope.bodyKeys);
      expect(Object.keys(error).every((key) => envelope.errorKeys.includes(key))).toBe(true);
      expect(header(response, envelope.requestIdHeader)).toBeTruthy();
      for (const [name, value] of Object.entries(envelope.requiredHeaders)) {
        expect(header(response, name)).toBe(value);
      }
      const details = error.details as Record<string, unknown> | undefined;
      if (details !== undefined) {
        expect(Object.keys(details).every((key) => envelope.allowedDetailKeys.includes(key))).toBe(
          true,
        );
      }
      const serialized = JSON.stringify(body);
      for (const marker of fixtures.leakMarkers) {
        expect(serialized).not.toContain(marker);
      }

      // The case.
      const { expect: expected } = fixture;
      expect(response.status).toBe(expected.status);
      expect(error.type).toBe(expected.type);
      expect(error.message).toBe(expected.message);
      if (expected.details) expect(details).toMatchObject(expected.details);
      if (expected.noDetails) expect(details).toBeUndefined();
      if (expected.issuePaths) {
        const issues = (details?.issues ?? []) as Array<{ path: unknown; message: unknown }>;
        expect(issues.map((issue) => issue.path)).toEqual(expected.issuePaths);
        for (const issue of issues) expect(typeof issue.message).toBe('string');
      }
      for (const [name, value] of Object.entries(expected.headers ?? {})) {
        expect(header(response, name)).toBe(value);
      }
    },
  );
});
