import { expectTypeOf, it } from 'vitest';
import {
  createApiKeyStrategy,
  createJwtStrategy,
  type AuthContext,
  type AuthStrategy,
  type HttpMethod,
  type ServeRequest,
} from '@hypequery/serve';
import {
  createMCPServeAuthenticator,
  type MCPHttpAuthenticator,
  type MCPServeAuthRequest,
  type MCPServeAuthStrategy,
  type MCPServeHttpMethod,
} from './index.js';

// Guards the /docs/mcp/remote "In your own server" snippet: serve strategies plug in under strict mode.
it('accepts @hypequery/serve auth strategies', () => {
  expectTypeOf<MCPServeHttpMethod>().toEqualTypeOf<HttpMethod>();
  expectTypeOf<MCPServeAuthRequest>().toExtend<ServeRequest>();
  expectTypeOf<AuthStrategy<AuthContext>>().toExtend<MCPServeAuthStrategy<AuthContext>>();

  const jwt = createJwtStrategy({
    jwksUri: 'https://example.auth0.com/.well-known/jwks.json',
    issuer: 'https://example.auth0.com/',
    audience: 'https://mcp.example.com/mcp',
  });
  const apiKey = createApiKeyStrategy({
    validate: async key => (key === 'fixture-key' ? { userId: 'u', tenantId: 't' } : null),
  });

  expectTypeOf(createMCPServeAuthenticator({ strategies: jwt })).toEqualTypeOf<MCPHttpAuthenticator>();
  expectTypeOf(createMCPServeAuthenticator({ strategies: apiKey })).toEqualTypeOf<MCPHttpAuthenticator>();
  expectTypeOf(createMCPServeAuthenticator({ strategies: [jwt, apiKey] })).toEqualTypeOf<MCPHttpAuthenticator>();
});
