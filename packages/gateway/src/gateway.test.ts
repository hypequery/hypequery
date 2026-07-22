import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createGateway, type Gateway } from './gateway.js';
import type { DevIntegrationApi } from './types.js';

class MockRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };

  constructor(
    url: string,
    method = 'GET',
    headers: Record<string, string> = {},
    remoteAddress = '192.168.1.20'
  ) {
    super();
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.socket = { remoteAddress };
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string | string[]> = {};
  body = '';

  setHeader(name: string, value: string | string[]) {
    this.headers[name] = value;
  }

  writeHead(status: number, headers: Record<string, string | string[]> = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
    return this;
  }

  write(data: string) {
    this.body += data;
    return true;
  }

  end(data?: string) {
    if (data) this.body += data;
  }
}

function api(): DevIntegrationApi {
  return {
    queryLogger: { on: () => () => {} } as DevIntegrationApi['queryLogger'],
    describe: () => ({ queries: [] }),
    execute: async () => null,
    cacheObservability: {
      getStats: async () => [],
      clear: async () => ({ cleared: [] })
    }
  };
}

describe('createGateway authentication', () => {
  let gateway: Gateway | undefined;

  afterEach(async () => {
    await gateway?.shutdown();
    gateway = undefined;
  });

  it('exchanges a shell token for an HttpOnly browser session', async () => {
    gateway = await createGateway(api(), {
      devToken: 'secret-token',
      storage: { forceMemory: true, silent: true }
    });
    const bootstrap = new MockResponse();
    await gateway.mount(
      new MockRequest('/__dev?token=secret-token') as unknown as IncomingMessage,
      bootstrap as unknown as ServerResponse
    );

    expect(bootstrap.statusCode).toBe(303);
    expect(bootstrap.headers.Location).toBe('/__dev/');
    const setCookie = bootstrap.headers['Set-Cookie'] as string;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    const session = new MockResponse();
    await gateway.mount(
      new MockRequest('/__dev/meta', 'GET', { cookie: setCookie.split(';')[0] }) as unknown as IncomingMessage,
      session as unknown as ServerResponse
    );
    expect(session.statusCode).toBe(200);
    expect(JSON.parse(session.body).contractVersion).toBe('0.1');
  });

  it('accepts bearer authentication and rejects invalid credentials', async () => {
    gateway = await createGateway(api(), {
      devToken: 'secret-token',
      storage: { forceMemory: true, silent: true }
    });
    const accepted = new MockResponse();
    await gateway.mount(
      new MockRequest('/__dev/meta', 'GET', { authorization: 'Bearer secret-token' }) as unknown as IncomingMessage,
      accepted as unknown as ServerResponse
    );
    expect(accepted.statusCode).toBe(200);

    const rejected = new MockResponse();
    await gateway.mount(
      new MockRequest('/__dev/meta', 'GET', { authorization: 'Bearer wrong' }) as unknown as IncomingMessage,
      rejected as unknown as ServerResponse
    );
    expect(rejected.statusCode).toBe(403);
  });

  it('allows credential-free preflight only through the configured CORS policy', async () => {
    gateway = await createGateway(api(), {
      devToken: 'secret-token',
      allowedOrigins: ['https://studio.example'],
      storage: { forceMemory: true, silent: true }
    });
    const response = new MockResponse();
    await gateway.mount(
      new MockRequest('/__dev/execute', 'OPTIONS', { origin: 'https://studio.example' }) as unknown as IncomingMessage,
      response as unknown as ServerResponse
    );
    expect(response.statusCode).toBe(204);
    expect(response.headers['Access-Control-Allow-Origin']).toBe('https://studio.example');
  });
});

/** DevIntegrationApi stub whose cache layer optionally supports clearing. */
function makeCapabilityApi(clearSupported: boolean): DevIntegrationApi {
  return {
    queryLogger: { on: () => () => {} } as DevIntegrationApi['queryLogger'],
    describe: () => ({ queries: [] }),
    execute: async () => null,
    cacheObservability: {
      getStats: async () =>
        clearSupported
          ? [{ layer: 'semantic' as const, stats: {}, clearSupported: true }]
          : [],
      clear: async () => ({ cleared: [] })
    }
  } as DevIntegrationApi;
}

describe('createGateway capabilities', () => {
  it('always advertises telemetry — the endpoints are always mounted', async () => {
    const gateway = await createGateway(makeCapabilityApi(false), {
      storage: { forceMemory: true, silent: true }
    });

    expect(gateway.capabilities).toContain('telemetry');
    expect(gateway.capabilities).toEqual(
      expect.arrayContaining(['registry', 'execute', 'history', 'events', 'cache'])
    );
    expect(gateway.capabilities).not.toContain('cache:clear');
    await gateway.shutdown();
  });

  it('advertises cache:clear only when a layer supports clearing', async () => {
    const gateway = await createGateway(makeCapabilityApi(true), {
      storage: { forceMemory: true, silent: true }
    });

    expect(gateway.capabilities).toContain('cache:clear');
    await gateway.shutdown();
  });
});
