import { describe, expect, it } from 'vitest';
import {
  createMCPServeAuthenticator,
  createMCPStaticKeyAuthenticator,
  MCPHttpAuthError,
} from './http-auth.js';
import { bearerToken, secretsEqual } from './utils/http-server/bearer.js';
import { hostAllowed, hostName, normalizeAllowedHosts, originAllowed } from './utils/http-server/guards.js';
import { bearerChallenge, protectedResource } from './utils/http-server/oauth.js';

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/mcp?x=1&x=2', { headers });
}

class AuthError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'AuthError';
  }
}

describe('createMCPStaticKeyAuthenticator', () => {
  const authenticate = createMCPStaticKeyAuthenticator({ key: 'k'.repeat(20), tenantId: 'acme', scopes: ['read'] });

  it('returns the configured principal for the key', async () => {
    await expect(authenticate(request({ authorization: `Bearer ${'k'.repeat(20)}` })))
      .resolves.toEqual({ subject: 'static-key', tenantId: 'acme', scopes: ['read'] });
  });

  it('returns null without a Bearer credential and refuses a wrong one', async () => {
    await expect(authenticate(request())).resolves.toBeNull();
    await expect(authenticate(request({ authorization: 'Basic abc' }))).resolves.toBeNull();
    await expect(authenticate(request({ authorization: 'Bearer nope' }))).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('rejects short keys', () => {
    expect(() => createMCPStaticKeyAuthenticator({ key: 'short' })).toThrow(/at least 16/);
  });
});

describe('createMCPServeAuthenticator', () => {
  it('maps a serve auth context to a principal, with tenant extraction', async () => {
    const authenticate = createMCPServeAuthenticator({
      strategies: async ({ request }) => {
        expect(request.path).toBe('/mcp');
        expect(request.query).toEqual({ x: ['1', '2'] });
        return { userId: 'u1', org: 'acme', scopes: ['a'] };
      },
      tenant: { extract: auth => auth.org as string },
    });
    await expect(authenticate(request())).resolves.toEqual({ subject: 'u1', tenantId: 'acme', scopes: ['a'] });
  });

  it('tries strategies in order like serve: invalid beats missing', async () => {
    const missing = async () => {
      throw new AuthError('MISSING');
    };
    const invalid = async () => {
      throw new AuthError('INVALID');
    };
    await expect(createMCPServeAuthenticator({ strategies: [missing] })(request())).resolves.toBeNull();
    await expect(createMCPServeAuthenticator({ strategies: [invalid, missing] })(request()))
      .rejects.toBeInstanceOf(MCPHttpAuthError);
    await expect(createMCPServeAuthenticator({
      strategies: [invalid, async () => ({ userId: 'u2' })],
    })(request())).resolves.toEqual({ subject: 'u2' });
  });

  it('refuses a verified credential without a subject and rethrows unexpected errors', async () => {
    await expect(createMCPServeAuthenticator({ strategies: async () => ({ tenantId: 't' }) })(request()))
      .rejects.toMatchObject({ code: 'invalid_token' });
    await expect(createMCPServeAuthenticator({
      strategies: async () => {
        throw new Error('boom');
      },
    })(request())).rejects.toThrow('boom');
  });

  it('requires at least one strategy', () => {
    expect(() => createMCPServeAuthenticator({ strategies: [] })).toThrow(/one or more/);
  });
});

describe('HTTP transport helpers', () => {
  it('reads Bearer tokens', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc ')).toBe('abc');
    expect(bearerToken('Bearer a b')).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });

  it('compares secrets', async () => {
    await expect(secretsEqual('a', 'a')).resolves.toBe(true);
    await expect(secretsEqual('a', 'b')).resolves.toBe(false);
    await expect(secretsEqual('a', 'aa')).resolves.toBe(false);
  });

  it('matches hosts without ports and origins exactly', () => {
    const allowed = normalizeAllowedHosts(undefined);
    expect(hostName('[::1]:8080')).toBe('[::1]');
    expect(hostAllowed('LOCALHOST:3333', allowed)).toBe(true);
    expect(hostAllowed('[::1]:3333', allowed)).toBe(true);
    expect(hostAllowed('evil.test', allowed)).toBe(false);
    expect(hostAllowed(null, allowed)).toBe(false);
    expect(originAllowed(null, new Set())).toBe(true);
    expect(originAllowed('https://a.test', new Set(['https://a.test']))).toBe(true);
    expect(originAllowed('https://b.test', new Set(['https://a.test']))).toBe(false);
  });

  it('builds RFC 9728 metadata and RFC 6750 challenges', () => {
    const resource = protectedResource({
      resource: 'https://mcp.example.test/mcp',
      authorizationServers: ['https://auth.example.test'],
      requiredScopes: ['read', 'read'],
    });
    expect(resource.metadataPath).toBe('/.well-known/oauth-protected-resource/mcp');
    expect(resource.document).toEqual({
      resource: 'https://mcp.example.test/mcp',
      authorization_servers: ['https://auth.example.test'],
      bearer_methods_supported: ['header'],
    });
    expect(resource.requiredScopes).toEqual(['read']);
    expect(protectedResource({ resource: 'https://mcp.example.test', authorizationServers: ['https://a.test'] }).metadataPath)
      .toBe('/.well-known/oauth-protected-resource');
    expect(bearerChallenge(undefined, undefined)).toBe('Bearer');
    expect(bearerChallenge('insufficient_scope', resource, ['read']))
      .toBe('Bearer error="insufficient_scope", scope="read", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"');
    expect(() => protectedResource({ resource: 'https://mcp.example.test', authorizationServers: ['https://a.test'], scopesSupported: ['bad scope'] }))
      .toThrow(/scope tokens/);
  });
});
