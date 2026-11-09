import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createJwtStrategy } from '@hypequery/serve';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MCPToolExecutor } from './executor.js';
import {
  createMCPServeAuthenticator,
  createMCPStaticKeyAuthenticator,
  MCPHttpAuthError,
  type MCPHttpAuthenticator,
  type MCPPrincipal,
} from './http-auth.js';
import { listenMCPHttpServer } from './http-node.js';
import { createMCPHttpHandler, type MCPHttpHandler, type MCPHttpHandlerOptions } from './http-server.js';

interface FixtureStep {
  request: { method: string; path: string; headers: Record<string, string>; body?: unknown; session?: number };
  expect: { status: number; headers?: Record<string, string>; json?: unknown; session?: boolean };
}
interface FixtureCase { id: string; profile: string; description: string; steps: FixtureStep[] }
interface FixtureProfile {
  path: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  auth: { kind: 'static-key'; key: string } | {
    kind: 'jwt'; secret: string; algorithm: string; issuer: string; audience: string; tenantClaim: string;
  };
  oauth?: MCPHttpHandlerOptions['oauth'];
}
const fixture = JSON.parse(readFileSync(
  new URL('../../../specs/mcp/http-transport-v1/cases.json', import.meta.url),
  'utf8',
)) as { version: number; profiles: Record<string, FixtureProfile>; cases: FixtureCase[] };

function fakeExecutor(principal?: MCPPrincipal): MCPToolExecutor {
  return {
    listTools: vi.fn(async () => ({
      tools: [{ name: 'whoami', description: 'Fixture', inputSchema: { type: 'object' as const, properties: {} } }],
    })),
    callTool: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ tenant: principal?.tenantId ?? null }) }],
    })),
    listPrompts: vi.fn(async () => ({ prompts: [] })),
    getPrompt: vi.fn(async () => ({ messages: [] })),
    getManifestHash: vi.fn(() => 'fixture-hash'),
  };
}

function authenticatorFor(profile: FixtureProfile): MCPHttpAuthenticator {
  if (profile.auth.kind === 'static-key') return createMCPStaticKeyAuthenticator({ key: profile.auth.key });
  const { secret, issuer, audience, algorithm, tenantClaim } = profile.auth;
  return createMCPServeAuthenticator({
    strategies: createJwtStrategy({
      secret,
      issuer,
      audience,
      algorithms: [algorithm],
      mapClaims: payload => ({
        userId: typeof payload.sub === 'string' ? payload.sub : undefined,
        tenantId: typeof payload[tenantClaim] === 'string' ? payload[tenantClaim] as string : undefined,
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : undefined,
      }),
    }),
  });
}

const handlers: MCPHttpHandler[] = [];
function handlerFor(options: MCPHttpHandlerOptions): MCPHttpHandler {
  const handler = createMCPHttpHandler(options);
  handlers.push(handler);
  return handler;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(handlers.splice(0).map(handler => handler.close()));
});

async function drain(response: Response): Promise<string> {
  // Read SSE responses only until their first event, which carries the reply.
  if (response.headers.get('content-type')?.startsWith('text/event-stream') && response.body) {
    const reader = response.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    return new TextDecoder().decode(value);
  }
  return response.text();
}

describe('HTTP transport fixture v1', () => {
  it('is the version this server implements', () => {
    expect(fixture.version).toBe(1);
  });

  for (const testCase of fixture.cases) {
    it(`${testCase.id}: ${testCase.description}`, async () => {
      const profile = fixture.profiles[testCase.profile];
      const handler = handlerFor({
        authenticate: authenticatorFor(profile),
        createExecutor: principal => fakeExecutor(principal),
        path: profile.path,
        allowedHosts: profile.allowedHosts,
        allowedOrigins: profile.allowedOrigins,
        oauth: profile.oauth,
      });
      const sessions: (string | null)[] = [];
      for (const [index, step] of testCase.steps.entries()) {
        const headers = new Headers(step.request.headers);
        if (step.request.session !== undefined) headers.set('mcp-session-id', sessions[step.request.session] ?? '');
        const response = await handler.handle(new Request(`http://mcp.example.test${step.request.path}`, {
          method: step.request.method,
          headers,
          body: step.request.body === undefined ? undefined : JSON.stringify(step.request.body),
        }));
        sessions.push(response.headers.get('mcp-session-id'));
        const text = await drain(response);
        expect(response.status, `step ${index}: ${text}`).toBe(step.expect.status);
        for (const [name, value] of Object.entries(step.expect.headers ?? {})) {
          expect(response.headers.get(name), `step ${index} header ${name}`).toBe(value);
        }
        if (step.expect.json !== undefined) expect(JSON.parse(text)).toEqual(step.expect.json);
        if (step.expect.session) expect(response.headers.get('mcp-session-id')).toMatch(/^[0-9a-f]{32}$/);
      }
    });
  }
});

const KEY = 'test-static-key-0123456789';
function staticHandler(overrides: Partial<MCPHttpHandlerOptions> = {}) {
  const createExecutor = vi.fn((principal: MCPPrincipal) => fakeExecutor(principal));
  const handler = handlerFor({
    authenticate: createMCPStaticKeyAuthenticator({ key: KEY, tenantId: 'acme' }),
    createExecutor,
    allowedHosts: ['mcp.example.test'],
    ...overrides,
  });
  return { handler, createExecutor };
}
function client(handler: MCPHttpHandler, key = KEY) {
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.example.test/mcp'), {
    fetch: (input, init) => handler.handle(new Request(input, init)),
    requestInit: { headers: { authorization: `Bearer ${key}` } },
  });
  return { client: new Client({ name: 'test', version: '1.0.0' }), transport };
}
const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
};
function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://mcp.example.test/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('createMCPHttpHandler', () => {
  it('serves the MCP SDK client end to end with the principal-scoped executor', async () => {
    const { handler, createExecutor } = staticHandler();
    const { client: mcp, transport } = client(handler);
    await mcp.connect(transport);
    await expect(mcp.listTools()).resolves.toMatchObject({ tools: [{ name: 'whoami' }] });
    const result = await mcp.callTool({ name: 'whoami', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ tenant: 'acme' }) }]);
    expect(createExecutor).toHaveBeenCalledTimes(1);
    expect(createExecutor.mock.calls[0][0]).toMatchObject({ subject: 'static-key', tenantId: 'acme' });
    expect(handler.sessionCount).toBe(1);
    await transport.terminateSession();
    expect(handler.sessionCount).toBe(0);
    await mcp.close();
  });

  it('serves over a real Node socket', async () => {
    const { handler } = staticHandler({ allowedHosts: ['127.0.0.1'] });
    const listener = await listenMCPHttpServer(handler, { port: 0 });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`${listener.url}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${KEY}` } },
      });
      const mcp = new Client({ name: 'test', version: '1.0.0' });
      await mcp.connect(transport);
      await expect(mcp.listTools()).resolves.toMatchObject({ tools: [{ name: 'whoami' }] });
      await mcp.close();
      // fetch replaces Host, so send the forged one with node:http.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const forged = httpRequest(`${listener.url}/mcp`, { method: 'POST', headers: { host: 'evil.example.test' } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        forged.on('error', reject);
        forged.end();
      });
      expect(status).toBe(421);
    } finally {
      await listener.close();
    }
  });

  it('builds nothing for a request that is not initialize', async () => {
    const { handler, createExecutor } = staticHandler();
    const response = await handler.handle(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    expect(response.status).toBe(400);
    expect(createExecutor).not.toHaveBeenCalled();
    expect(handler.sessionCount).toBe(0);
  });

  it('answers 503 without details when the executor cannot be created', async () => {
    const { handler } = staticHandler({
      createExecutor: () => {
        throw new Error('backend https://secret.example.test refused PRIVATE_TOKEN');
      },
    });
    const response = await handler.handle(post(initialize));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|PRIVATE/);
    expect(handler.sessionCount).toBe(0);
  });

  it('caps open sessions', async () => {
    const { handler } = staticHandler({ maxSessions: 1 });
    expect((await handler.handle(post(initialize))).status).toBe(200);
    const refused = await handler.handle(post(initialize));
    expect(refused.status).toBe(503);
    expect(handler.sessionCount).toBe(1);
  });

  it('refuses oversized and malformed bodies before parsing them as MCP', async () => {
    const { handler, createExecutor } = staticHandler({ maxRequestBodyBytes: 64 });
    expect((await handler.handle(post(initialize))).status).toBe(413);
    const { handler: other } = staticHandler();
    expect((await other.handle(post('{not json'))).status).toBe(400);
    expect(createExecutor).not.toHaveBeenCalled();
  });

  it('closes sessions that stay idle', async () => {
    vi.useFakeTimers();
    const { handler } = staticHandler({ sessionIdleTimeoutMs: 1000 });
    const response = await handler.handle(post(initialize));
    await drain(response);
    expect(handler.sessionCount).toBe(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(handler.sessionCount).toBe(0);
  });

  it('hides unexpected authenticator errors', async () => {
    const { handler } = staticHandler({
      authenticate: () => {
        throw new Error('database password is hunter2');
      },
    });
    const response = await handler.handle(post(initialize));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
  });

  it('lets an authenticator refuse with insufficient_scope without OAuth configured', async () => {
    const { handler } = staticHandler({
      authenticate: () => {
        throw new MCPHttpAuthError('insufficient_scope', 'no', { scopes: ['analytics:read'] });
      },
    });
    const response = await handler.handle(post(initialize));
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toBe('Bearer error="insufficient_scope", scope="analytics:read"');
  });

  it('refuses a malformed principal', async () => {
    const { handler } = staticHandler({ authenticate: () => ({ subject: '' }) });
    expect((await handler.handle(post(initialize))).status).toBe(500);
  });

  it('opens no session when close() runs while the executor is still being created', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const createExecutor = vi.fn(async (principal: MCPPrincipal) => {
      await gate;
      return fakeExecutor(principal);
    });
    const { handler } = staticHandler({ createExecutor });
    const pending = handler.handle(post(initialize));
    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));

    await handler.close();
    release();
    const response = await pending;

    // The backend answered after shutdown: the caller is told, and nothing was left open.
    expect(response.status).toBe(503);
    expect(handler.sessionCount).toBe(0);
    expect(response.headers.get('mcp-session-id')).toBeNull();
  });

  it('answers a browser preflight without a credential and lets extra request headers through', async () => {
    const { handler } = staticHandler({
      allowedOrigins: ['https://app.example.test'],
      allowedRequestHeaders: ['X-Api-Key'],
    });
    const preflight = await handler.handle(new Request('http://mcp.example.test/mcp', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.test', 'access-control-request-method': 'POST' },
    }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-api-key');
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('stops serving once closed', async () => {
    const { handler } = staticHandler();
    await drain(await handler.handle(post(initialize)));
    await handler.close();
    expect(handler.sessionCount).toBe(0);
    expect((await handler.handle(post(initialize))).status).toBe(503);
  });

  it('validates its configuration', () => {
    const base = { authenticate: () => null, createExecutor: () => fakeExecutor() };
    expect(() => createMCPHttpHandler({ ...base, path: 'mcp' })).toThrow(/absolute path/);
    expect(() => createMCPHttpHandler({ ...base, maxSessions: 0 })).toThrow(/positive integer/);
    expect(() => createMCPHttpHandler({ ...base, allowedOrigins: ['https://app.example.test/path'] })).toThrow(/bare origins/);
    expect(() => createMCPHttpHandler({ ...base, allowedHosts: [] })).toThrow(/at least one/);
    expect(() => createMCPHttpHandler({
      ...base,
      oauth: { resource: 'http://mcp.example.test/mcp', authorizationServers: ['https://auth.example.test'] },
    })).toThrow(/https/);
    expect(() => createMCPHttpHandler({
      ...base,
      oauth: { resource: 'https://mcp.example.test/mcp', authorizationServers: [] },
    })).toThrow(/at least one/);
    expect(() => createMCPHttpHandler({ createExecutor: base.createExecutor } as unknown as MCPHttpHandlerOptions))
      .toThrow(/authenticate is required/);
  });
});
